import type { Express, Request, Response, NextFunction } from "express";
import type { AppConfig } from "../config/env.js";
import { asObjectId, iso, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { requireLiveSession } from "../middleware/requireLiveSession.js";

function mapN8nAlert(doc: Record<string, unknown>) {
  return {
    id: toId(doc._id),
    eventId: typeof doc.eventId === "string" ? doc.eventId : undefined,
    organisationId: toId(doc.organisationId),
    machineId: doc.machineId ? toId(doc.machineId) : undefined,
    severity: doc.severity,
    title: doc.title,
    message: doc.message,
    read: Boolean(doc.read),
    type: doc.type ?? "workflow",
    status: doc.status ?? "open",
    sourceType: doc.sourceType ?? "workflow",
    createdAt: iso(doc.createdAt),
  };
}

export function registerN8nAlertRoutes(app: Express, _config: AppConfig) {
  const prefix = `${_config.apiPrefix}/alerts`;

  app.get(
    prefix,
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
        const organisationId = asObjectId(session.organisationId);
        if (!organisationId) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "Invalid organisation." },
          });
          return;
        }

        const rows = await db
          .collection("alerts")
          .find({
            organisationId,
            eventId: { $exists: true },
          })
          .sort({ createdAt: -1 })
          .limit(100)
          .toArray();

        const unreadCount = await db.collection("alerts").countDocuments({
          organisationId,
          eventId: { $exists: true },
          read: { $ne: true },
        });

        response.json({
          success: true,
          data: {
            alerts: rows.map((row) => mapN8nAlert(row)),
            unreadCount,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    `${prefix}/:id/read`,
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
        const alertId = asObjectId(String(request.params.id ?? ""));
        const organisationId = asObjectId(session.organisationId);
        if (!alertId || !organisationId) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "Invalid alert id." },
          });
          return;
        }

        const updated = await db.collection("alerts").findOneAndUpdate(
          { _id: alertId, organisationId, eventId: { $exists: true } },
          { $set: { read: true, updatedAt: new Date() } },
          { returnDocument: "after" },
        );
        if (!updated) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Alert not found." },
          });
          return;
        }
        response.json({ success: true, data: mapN8nAlert(updated) });
      } catch (error) {
        next(error);
      }
    },
  );
}
