import type { Express, Request, Response, NextFunction } from "express";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { requireLiveSession } from "../middleware/requireLiveSession.js";
import { isN8nConfigured, postJson } from "../services/n8nClient.js";
import { createWorkflowRequest, findWorkflowRequest } from "../services/workflowRequests.js";
import { assertN8nSafeId, newN8nRequestId } from "../util/n8nIds.js";

export function registerHandoverWorkflowRoutes(app: Express, config: AppConfig) {
  const prefix = config.apiPrefix;

  app.post(
    `${prefix}/shifts/:shiftId/handover`,
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
        if (!isN8nConfigured(config) || !config.n8nShiftHandoverWebhookUrl) {
          response.status(503).json({
            success: false,
            error: { code: "UNAVAILABLE", message: "Shift handover is not configured." },
          });
          return;
        }

        const shiftIdRaw = String(request.params.shiftId ?? "");
        assertN8nSafeId(shiftIdRaw, "shiftId");
        const shiftId = asObjectId(shiftIdRaw);
        const organisationId = asObjectId(session.organisationId);
        if (!shiftId || !organisationId) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "Invalid shift id." },
          });
          return;
        }

        const shift = await db.collection("shifts").findOne({
          _id: shiftId,
          organisationId,
        });
        if (!shift) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Shift not found." },
          });
          return;
        }

        const requestId = newN8nRequestId();
        await createWorkflowRequest(db, {
          requestId,
          type: "shift_handover",
          organisationId,
          userId: asObjectId(session.userId)!,
          shiftId,
        });

        void postJson(config, config.n8nShiftHandoverWebhookUrl, {
          shiftId: shiftIdRaw,
          organisationId: session.organisationId,
          requestId,
        }).catch(() => {
          /* client polls */
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
    `${prefix}/handovers/:requestId`,
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
        if (!doc || doc.type !== "shift_handover") {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Handover request not found." },
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

        let handover = null;
        if (doc.status === "completed") {
          handover = await db.collection("handovers").findOne({ requestId });
        }

        response.json({
          success: true,
          data: {
            requestId,
            status: doc.status,
            result: doc.result ?? null,
            handover: handover
              ? {
                  id: toId(handover._id),
                  summaryMarkdown: handover.summaryMarkdown ?? handover.summary,
                  memoryIds: (handover.memoryIds ?? []).map((id: unknown) => toId(id)),
                  generatedAt:
                    handover.generatedAt instanceof Date
                      ? handover.generatedAt.toISOString()
                      : null,
                }
              : null,
            errorMessage: doc.status === "failed" ? doc.errorMessage ?? null : null,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
