import type { Express, Request, Response, NextFunction } from "express";
import multer from "multer";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { requireLiveSession } from "../middleware/requireLiveSession.js";
import { isN8nConfigured, postMultipart } from "../services/n8nClient.js";
import { createWorkflowRequest, findWorkflowRequest } from "../services/workflowRequests.js";
import { validateAudioUpload, VOICE_AUDIO_MAX_BYTES } from "../util/audioUpload.js";
import { assertN8nSafeId, newN8nRequestId } from "../util/n8nIds.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOICE_AUDIO_MAX_BYTES },
});

export function registerReportsVoiceRoutes(app: Express, config: AppConfig) {
  const prefix = `${config.apiPrefix}/reports`;

  app.post(
    `${prefix}/voice`,
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
        if (!isN8nConfigured(config) || !config.n8nWorkerReportWebhookUrl) {
          response.status(503).json({
            success: false,
            error: { code: "UNAVAILABLE", message: "Voice reports are not configured." },
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
        const machineId = asObjectId(machineIdRaw);
        const organisationId = asObjectId(session.organisationId);
        if (!machineId || !organisationId) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "Invalid machine or organisation." },
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

        const audio = validateAudioUpload(request.file, VOICE_AUDIO_MAX_BYTES);
        if (!audio.ok) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: audio.message },
          });
          return;
        }

        const requestId = newN8nRequestId();
        await createWorkflowRequest(db, {
          requestId,
          type: "worker_report",
          organisationId,
          userId: asObjectId(session.userId)!,
          machineId,
        });

        void postMultipart(
          config,
          config.n8nWorkerReportWebhookUrl,
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
        ).catch(() => {
          /* n8n may still process; client polls status */
        });

        response.status(202).json({
          success: true,
          data: { requestId },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${prefix}/voice/:requestId`,
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
        if (!doc || doc.type !== "worker_report") {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Voice report request not found." },
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
        response.json({
          success: true,
          data: {
            requestId,
            status: doc.status,
            result: doc.status === "completed" ? doc.result ?? null : null,
            errorMessage: doc.status === "failed" ? doc.errorMessage ?? null : null,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
