import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import { ObjectId } from "mongodb";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { requireLiveSession } from "../middleware/requireLiveSession.js";
import { answerMachineFromMongo } from "../services/machineVoiceFallback.js";
import { N8nClientError, isN8nConfigured, postMultipart } from "../services/n8nClient.js";
import {
  createWorkflowRequest,
  findWorkflowRequest,
} from "../services/workflowRequests.js";
import { validateAudioUpload, VOICE_AUDIO_MAX_BYTES } from "../util/audioUpload.js";
import { assertN8nSafeId, newN8nRequestId } from "../util/n8nIds.js";

const N8N_PENDING_FALLBACK_MS = 20_000;
/** Hard gap between voice questions per user — protects n8n from floods. */
const VOICE_QUESTION_RATE_LIMIT_MS = 60 * 1000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOICE_AUDIO_MAX_BYTES },
});

async function machineInOrganisation(
  machineIdRaw: string,
  organisationIdRaw: string,
): Promise<{ ok: true; machineId: ReturnType<typeof asObjectId> } | { ok: false }> {
  const db = getDb();
  if (!db) return { ok: false };
  const machineId = asObjectId(machineIdRaw);
  const organisationId = asObjectId(organisationIdRaw);
  if (!machineId || !organisationId) return { ok: false };
  const machine = await db.collection("machines").findOne({
    _id: machineId,
    organisationId,
  });
  if (!machine) return { ok: false };
  return { ok: true, machineId };
}

function mapVoiceResult(doc: Record<string, unknown>) {
  const result = (doc.result ?? {}) as Record<string, unknown>;
  const answer = String(result.answer ?? "");
  const evidenceIds = Array.isArray(result.evidenceRecordIds)
    ? (result.evidenceRecordIds as string[])
    : [];
  return { answer, evidenceIds };
}

async function buildEvidenceResponse(
  db: NonNullable<ReturnType<typeof getDb>>,
  organisationId: string,
  requestId: string,
  answer: string,
  evidenceIds: string[],
) {
  const evidence: Array<{
    recordId: string;
    text: string;
    createdAt: string;
    machineId: string;
  }> = [];
  for (const recordId of evidenceIds) {
    const id = asObjectId(recordId);
    if (!id) continue;
    const memory = await db.collection("memories").findOne(
      {
        _id: id,
        organisationId: asObjectId(organisationId),
      },
      { projection: { text: 1, content: 1, createdAt: 1, machineId: 1, embedding: 0 } },
    );
    if (!memory) continue;
    const snippet = String(memory.text ?? memory.content ?? "").slice(0, 280);
    evidence.push({
      recordId,
      text: snippet,
      createdAt:
        memory.createdAt instanceof Date
          ? memory.createdAt.toISOString()
          : new Date().toISOString(),
      machineId: toId(memory.machineId),
    });
  }
  return { requestId, answer, evidence };
}

async function respondWithMongoFallback(
  db: NonNullable<ReturnType<typeof getDb>>,
  config: AppConfig,
  input: {
    requestId: string;
    organisationId: ObjectId;
    machineId: ObjectId;
  },
  response: Response,
) {
  const fallback = await answerMachineFromMongo(db, config, {
    organisationId: input.organisationId,
    machineId: input.machineId,
  });
  // Allow pending or previously-failed requests to complete with Mongo results.
  await db.collection("workflow_requests").updateOne(
    { requestId: input.requestId },
    {
      $set: {
        status: "completed",
        result: {
          answer: fallback.answer,
          evidenceRecordIds: fallback.evidenceRecordIds,
          source: fallback.source,
        },
        completedAt: new Date(),
      },
      $unset: { errorMessage: "" },
    },
  );
  response.json({
    success: true,
    data: {
      requestId: input.requestId,
      answer: fallback.answer,
      evidence: fallback.evidence,
    },
  });
}

export function registerVoiceRoutes(app: Express, config: AppConfig) {
  const prefix = `${config.apiPrefix}/voice`;

  app.post(
    `${prefix}/questions`,
    requireLiveSession,
    upload.single("audioFile"),
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const session = request.liveSession;
        if (!session) return;
        const db = getDb();
        if (!db) {
          response.status(503).json({
            success: false,
            error: { code: "UNAVAILABLE", message: "MongoDB is not connected." },
          });
          return;
        }

        const machineIdRaw = String(request.body?.machineId ?? "").trim();
        if (!machineIdRaw) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "machineId is required." },
          });
          return;
        }
        const machineCheck = await machineInOrganisation(machineIdRaw, session.organisationId);
        if (!machineCheck.ok || !machineCheck.machineId) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Machine not found." },
          });
          return;
        }

        const organisationId = asObjectId(session.organisationId)!;
        const userId = asObjectId(session.userId)!;
        const machineId = machineCheck.machineId;

        const audio = validateAudioUpload(request.file, VOICE_AUDIO_MAX_BYTES);
        if (!audio.ok) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: audio.message },
          });
          return;
        }

        const rateCutoff = new Date(Date.now() - VOICE_QUESTION_RATE_LIMIT_MS);
        const recent = await db.collection("workflow_requests").findOne(
          {
            type: "voice_question",
            userId,
            organisationId,
            createdAt: { $gte: rateCutoff },
          },
          { sort: { createdAt: -1 } },
        );
        if (recent?.createdAt instanceof Date) {
          const retryAt = recent.createdAt.getTime() + VOICE_QUESTION_RATE_LIMIT_MS;
          const waitSeconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
          response.status(429).json({
            success: false,
            error: {
              code: "RATE_LIMITED",
              message: `Voice is limited to one request per minute. Try again in about ${waitSeconds} second${waitSeconds === 1 ? "" : "s"}.`,
              retryAt: new Date(retryAt).toISOString(),
            },
          });
          return;
        }

        const requestId = newN8nRequestId();
        assertN8nSafeId(session.organisationId, "organisationId");
        assertN8nSafeId(machineIdRaw, "machineId");

        await createWorkflowRequest(db, {
          requestId,
          type: "voice_question",
          organisationId,
          userId,
          machineId,
        });

        const n8nReady =
          isN8nConfigured(config) && Boolean(config.n8nVoiceQuestionWebhookUrl);

        if (!n8nReady) {
          await respondWithMongoFallback(
            db,
            config,
            { requestId, organisationId, machineId },
            response,
          );
          return;
        }

        try {
          await postMultipart(
            config,
            config.n8nVoiceQuestionWebhookUrl!,
            {
              machineId: machineIdRaw,
              organisationId: session.organisationId,
              requestId,
            },
            {
              buffer: request.file!.buffer,
              filename: audio.filename,
              mimetype: audio.mimetype,
            },
          );
        } catch (error) {
          const message =
            error instanceof N8nClientError
              ? error.code === "TIMEOUT"
                ? "Voice request timed out waiting for n8n."
                : error.message
              : "Voice assistant is temporarily unavailable.";
          console.warn(`n8n voice question failed; using Mongo fallback: ${message}`);
          await respondWithMongoFallback(
            db,
            config,
            { requestId, organisationId, machineId },
            response,
          );
          return;
        }

        const refreshed = await findWorkflowRequest(db, requestId);
        if (!refreshed) {
          response.status(500).json({
            success: false,
            error: { code: "INTERNAL_ERROR", message: "Request could not be loaded." },
          });
          return;
        }
        if (refreshed.status === "completed") {
          const mapped = mapVoiceResult(refreshed);
          const payload = await buildEvidenceResponse(
            db,
            session.organisationId,
            requestId,
            mapped.answer,
            mapped.evidenceIds,
          );
          response.json({ success: true, data: payload });
          return;
        }
        if (refreshed.status === "failed") {
          console.warn("n8n marked voice question failed; using Mongo fallback.");
          await respondWithMongoFallback(
            db,
            config,
            { requestId, organisationId, machineId },
            response,
          );
          return;
        }
        response.status(202).json({
          success: true,
          data: { requestId, status: "pending" },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/resolve-overheating`,
    requireLiveSession,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const session = request.liveSession;
        if (!session) return;
        const db = getDb();
        if (!db) {
          response.status(503).json({
            success: false,
            error: { code: "UNAVAILABLE", message: "MongoDB is not connected." },
          });
          return;
        }
        if (session.role !== "worker" && session.role !== "admin") {
          response.status(403).json({
            success: false,
            error: { code: "FORBIDDEN", message: "Not allowed." },
          });
          return;
        }
        const machineIdRaw = String(request.body?.machineId ?? "").trim();
        const machineId = asObjectId(machineIdRaw);
        const organisationId = asObjectId(session.organisationId);
        const userId = asObjectId(session.userId);
        if (!machineId || !organisationId || !userId) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "machineId is required." },
          });
          return;
        }
        const machine = await db.collection("machines").findOne({
          _id: machineId,
          organisationId,
        });
        if (!machine) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Machine not found." },
          });
          return;
        }
        const user = await db.collection("users").findOne({ _id: userId });
        const workerName = String(user?.displayName ?? "Worker");
        const orgIdString = toId(organisationId);
        const machineIdString = toId(machineId);
        const overheatingFilter = {
          status: { $nin: ["resolved", "dismissed"] },
          $and: [
            {
              $or: [
                { organisationId },
                { organisationIdString: orgIdString },
              ],
            },
            {
              $or: [{ machineId }, { machineIdString }],
            },
            {
              $or: [
                { issueKind: "overheating" },
                { title: { $regex: "overheat", $options: "i" } },
                { message: { $regex: "overheat", $options: "i" } },
                { severity: "critical", type: "machine_hazard" },
              ],
            },
          ],
        };
        const doomed = await db.collection("alerts").find(overheatingFilter).toArray();
        if (doomed.length > 0) {
          await db.collection("alerts").deleteMany({
            _id: { $in: doomed.map((row) => row._id) },
          });
        }
        const now = new Date();
        const memoryId = new ObjectId();
        const logTitle = `Overheating issue solved by ${workerName}`;
        const logContent = `${workerName} cleared the overheating hold on ${String(machine.machineCode)} via Voice Assistant. Database record updated.`;
        await db.collection("memories").insertOne({
          _id: memoryId,
          organisationId,
          machineId,
          organisationIdString: toId(organisationId),
          machineIdString: toId(machineId),
          type: "incident",
          title: logTitle,
          content: logContent,
          summary: logTitle,
          text: `${logTitle}. ${logContent}`,
          status: "verified",
          source: { type: "voice", submittedBy: userId },
          tags: ["overheating", "voice", "resolved"],
          currentRevision: 1,
          example: false,
          embeddingStatus: "pending",
          contentVersion: 1,
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
          verifiedAt: now,
        });
        const message = `Database record updated. New log created: Overheating issue solved by ${workerName}`;
        response.json({
          success: true,
          data: {
            message,
            removedCount: doomed.length,
            memoryId: toId(memoryId),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${prefix}/questions/:requestId`,
    requireLiveSession,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const session = request.liveSession;
        if (!session) return;
        const db = getDb();
        if (!db) {
          response.status(503).json({
            success: false,
            error: { code: "UNAVAILABLE", message: "MongoDB is not connected." },
          });
          return;
        }
        const requestId = String(request.params.requestId ?? "");
        assertN8nSafeId(requestId, "requestId");
        const doc = await findWorkflowRequest(db, requestId);
        if (!doc || doc.type !== "voice_question") {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Voice question not found." },
          });
          return;
        }
        if (toId(doc.organisationId) !== session.organisationId) {
          response.status(403).json({
            success: false,
            error: { code: "FORBIDDEN", message: "Not allowed for this organisation." },
          });
          return;
        }
        const organisationId = asObjectId(session.organisationId);
        const machineId = doc.machineId ? asObjectId(toId(doc.machineId)) : null;
        const createdAt =
          doc.createdAt instanceof Date ? doc.createdAt.getTime() : Date.now();
        const pendingTooLong =
          doc.status === "pending" && Date.now() - createdAt >= N8N_PENDING_FALLBACK_MS;

        if (
          (doc.status === "failed" || pendingTooLong) &&
          organisationId &&
          machineId
        ) {
          console.warn(
            `voice question ${requestId} ${doc.status}${
              pendingTooLong ? " (stale pending)" : ""
            }; using Mongo fallback.`,
          );
          await respondWithMongoFallback(
            db,
            config,
            { requestId, organisationId, machineId },
            response,
          );
          return;
        }

        if (doc.status === "pending") {
          response.status(202).json({
            success: true,
            data: { requestId, status: "pending" },
          });
          return;
        }
        if (doc.status === "failed") {
          response.status(502).json({
            success: false,
            error: {
              code: "UNAVAILABLE",
              message: "Voice assistant could not complete the request.",
            },
          });
          return;
        }
        const mapped = mapVoiceResult(doc);
        const payload = await buildEvidenceResponse(
          db,
          session.organisationId,
          requestId,
          mapped.answer,
          mapped.evidenceIds,
        );
        response.json({ success: true, data: payload });
      } catch (error) {
        next(error);
      }
    },
  );
}
