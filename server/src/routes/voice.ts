import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { requireLiveSession } from "../middleware/requireLiveSession.js";
import { N8nClientError, isN8nConfigured, postMultipart } from "../services/n8nClient.js";
import {
  createWorkflowRequest,
  failWorkflowRequest,
  findWorkflowRequest,
} from "../services/workflowRequests.js";
import { validateAudioUpload, VOICE_AUDIO_MAX_BYTES } from "../util/audioUpload.js";
import { assertN8nSafeId, newN8nRequestId } from "../util/n8nIds.js";

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
        if (!isN8nConfigured(config) || !config.n8nVoiceQuestionWebhookUrl) {
          response.status(503).json({
            success: false,
            error: { code: "UNAVAILABLE", message: "Voice assistant is not configured." },
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

        const audio = validateAudioUpload(request.file, VOICE_AUDIO_MAX_BYTES);
        if (!audio.ok) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: audio.message },
          });
          return;
        }

        const requestId = newN8nRequestId();
        assertN8nSafeId(session.organisationId, "organisationId");
        assertN8nSafeId(machineIdRaw, "machineId");

        await createWorkflowRequest(db, {
          requestId,
          type: "voice_question",
          organisationId: asObjectId(session.organisationId)!,
          userId: asObjectId(session.userId)!,
          machineId: machineCheck.machineId,
        });

        try {
          await postMultipart(
            config,
            config.n8nVoiceQuestionWebhookUrl,
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
            error instanceof N8nClientError && error.code === "TIMEOUT"
              ? "Voice request timed out."
              : "Voice assistant is temporarily unavailable.";
          await failWorkflowRequest(db, requestId, message);
          const status = error instanceof N8nClientError && error.code === "TIMEOUT" ? 504 : 502;
          response.status(status).json({
            success: false,
            error: { code: "UNAVAILABLE", message },
          });
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
          response.status(502).json({
            success: false,
            error: {
              code: "UNAVAILABLE",
              message: "Voice assistant could not complete the request.",
            },
          });
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
