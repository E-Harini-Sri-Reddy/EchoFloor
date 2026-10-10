/**
 * ASSUMPTIONS (n8n / Atlas vector search):
 * - Memory documents live in collection `memories` (not renamed to `records`).
 * - organisationId and machineId are stored as ObjectIds; we dual-write
 *   organisationIdString and machineIdString for n8n $vectorSearch filters.
 * - Shift handover window uses shift.startAt/endAt when present, else last 12 hours.
 */
import express, { type Express, type Response } from "express";
import { MongoServerError, ObjectId } from "mongodb";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { requireN8nSecret } from "../middleware/requireN8nSecret.js";
import { buildSearchableText } from "../services/buildSearchableText.js";
import { emitAlertEvent } from "../services/alertEvents.js";
import { triggerMemoryEmbedding } from "../services/memoryEmbedding.js";
import { buildHandoverPayload } from "../services/handoverData.js";
import {
  completeWorkflowRequest,
  findWorkflowRequest,
} from "../services/workflowRequests.js";
import { assertN8nSafeId, newN8nEventId } from "../util/n8nIds.js";

function callbackRouter(config: AppConfig) {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));
  router.use(requireN8nSecret(config));
  return router;
}

function validationError(response: Response, message: string) {
  response.status(400).json({
    success: false,
    error: { code: "VALIDATION", message },
  });
}

async function filterRecordIds(
  db: NonNullable<ReturnType<typeof getDb>>,
  recordIds: string[],
  organisationId: ObjectId,
  machineId: ObjectId | null,
): Promise<string[]> {
  const kept: string[] = [];
  let dropped = 0;
  for (const raw of recordIds) {
    let id: ObjectId | null;
    try {
      assertN8nSafeId(raw, "recordId");
      id = asObjectId(raw);
    } catch {
      dropped += 1;
      continue;
    }
    if (!id) {
      dropped += 1;
      continue;
    }
    const filter: Record<string, unknown> = {
      _id: id,
      organisationId,
    };
    if (machineId) filter.machineId = machineId;
    const doc = await db.collection("memories").findOne(filter, { projection: { _id: 1 } });
    if (doc) kept.push(toId(doc._id));
    else dropped += 1;
  }
  if (dropped > 0) {
    console.info(`n8n callback dropped ${dropped} recordIds after tenant filter.`);
  }
  return kept;
}

export function registerWorkflowRoutes(app: Express, config: AppConfig) {
  const prefix = `${config.apiPrefix}/workflows`;
  const router = callbackRouter(config);

  router.post("/callbacks/voice-answers", async (request, response, next) => {
    try {
      const db = getDb();
      if (!db) {
        response.status(503).json({ success: false, error: { code: "UNAVAILABLE", message: "MongoDB unavailable." } });
        return;
      }
      const requestId = String(request.body?.requestId ?? "");
      const answer = String(request.body?.answer ?? "");
      const recordIdsRaw = Array.isArray(request.body?.recordIds)
        ? (request.body.recordIds as unknown[])
        : [];
      if (!requestId || !answer.trim()) {
        validationError(response, "requestId and answer are required.");
        return;
      }
      assertN8nSafeId(requestId, "requestId");

      const existing = await findWorkflowRequest(db, requestId);
      if (!existing) {
        validationError(response, "Unknown requestId.");
        return;
      }
      if (existing.status === "completed") {
        response.json({ ok: true });
        return;
      }
      if (existing.status !== "pending") {
        validationError(response, "Request is not pending.");
        return;
      }

      const orgId = existing.organisationId as ObjectId;
      const machineId = existing.machineId ? (existing.machineId as ObjectId) : null;
      const recordIds = await filterRecordIds(
        db,
        recordIdsRaw.map((item) => String(item)),
        orgId,
        machineId,
      );

      const { updated } = await completeWorkflowRequest(db, requestId, {
        answer: answer.trim(),
        evidenceRecordIds: recordIds,
      });
      if (!updated) {
        response.json({ ok: true });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/callbacks/worker-reports", async (request, response, next) => {
    try {
      const db = getDb();
      if (!db) {
        response.status(503).json({ success: false, error: { code: "UNAVAILABLE", message: "MongoDB unavailable." } });
        return;
      }
      const requestId = String(request.body?.requestId ?? "");
      const report = request.body?.report;
      if (!requestId || !report || typeof report !== "object") {
        validationError(response, "requestId and report are required.");
        return;
      }
      assertN8nSafeId(requestId, "requestId");

      const wf = await findWorkflowRequest(db, requestId);
      if (!wf || wf.type !== "worker_report") {
        validationError(response, "Unknown worker report request.");
        return;
      }
      if (wf.status === "completed") {
        response.json({ ok: true });
        return;
      }
      if (wf.status !== "pending") {
        validationError(response, "Request is not pending.");
        return;
      }

      const orgId = wf.organisationId as ObjectId;
      const machineId = wf.machineId as ObjectId;
      const machine = await db.collection("machines").findOne({ _id: machineId, organisationId: orgId });
      if (!machine) {
        validationError(response, "Machine not found for request.");
        return;
      }

      const reportObj = report as Record<string, unknown>;
      const issue = reportObj.issue as Record<string, unknown> | undefined;
      const issueDescription =
        issue && typeof issue.description === "string" ? issue.description.trim() : "";
      const actionsTaken = Array.isArray(reportObj.actionsTaken)
        ? reportObj.actionsTaken.map((item) => String(item))
        : [];
      const constraints = Array.isArray(reportObj.constraints)
        ? reportObj.constraints.filter((item) => item && typeof item === "object")
        : [];
      const uncertainties = Array.isArray(reportObj.uncertainties)
        ? reportObj.uncertainties.map((item) => String(item))
        : [];
      const machineIdentifier =
        typeof reportObj.machineIdentifier === "string"
          ? reportObj.machineIdentifier.trim()
          : null;

      const machineMismatch = Boolean(
        machineIdentifier &&
          machineIdentifier !== String(machine.name ?? "") &&
          machineIdentifier !== String(machine.machineCode ?? ""),
      );

      const now = new Date();
      const memoryId = new ObjectId();
      const memoryDoc = {
        _id: memoryId,
        organisationId: orgId,
        organisationIdString: toId(orgId),
        machineId,
        machineIdString: toId(machineId),
        type: "operational_note",
        title: issueDescription.slice(0, 120) || "Worker voice report",
        content: issueDescription || "Worker voice report (details in workerReport).",
        summary: issueDescription.slice(0, 240) || undefined,
        status: "pending_review",
        source: { type: "voice", submittedBy: wf.userId, workerReport: true },
        workerReport: {
          machineIdentifier,
          issue: { description: issueDescription || null },
          actionsTaken,
          constraints,
          uncertainties,
        },
        machineMismatch,
        tags: ["worker_report"],
        currentRevision: 1,
        example: false,
        createdBy: wf.userId,
        createdAt: now,
        updatedAt: now,
        text: "",
        contentVersion: 1,
        embeddingStatus: "pending",
        embeddingAttempts: 0,
      };
      memoryDoc.text = buildSearchableText(memoryDoc, {
        machineName: String(machine.name ?? ""),
      });

      await db.collection("memories").insertOne(memoryDoc);

      for (const constraint of constraints) {
        const row = constraint as Record<string, unknown>;
        const description = String(row.description ?? "").trim();
        if (!description) continue;
        await db.collection("constraints").insertOne({
          _id: new ObjectId(),
          organisationId: orgId,
          machineId,
          title: description.slice(0, 120),
          description,
          durationText: typeof row.duration === "string" ? row.duration : null,
          status: "active",
          severity: "warning",
          effectiveAt: now,
          sourceMemoryId: memoryId,
          createdBy: wf.userId,
          createdAt: now,
          updatedAt: now,
        });
      }

      await completeWorkflowRequest(db, requestId, {
        memoryId: toId(memoryId),
        report: reportObj,
      });

      triggerMemoryEmbedding(
        config,
        toId(memoryId),
        toId(orgId),
        1,
        memoryDoc.text,
      );
      emitAlertEvent(config, {
        eventId: newN8nEventId("report-created", [toId(memoryId)]),
        organisationId: toId(orgId),
        machineId: toId(machineId),
        eventType: "new_report",
        eventDetails: {
          memoryId: toId(memoryId),
          requestId,
        },
      });

      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/callbacks/embeddings", async (request, response, next) => {
    try {
      const db = getDb();
      if (!db) {
        response.status(503).json({ success: false, error: { code: "UNAVAILABLE", message: "MongoDB unavailable." } });
        return;
      }
      const memoryIdRaw = String(request.body?.memoryId ?? "");
      const organisationIdRaw = String(request.body?.organisationId ?? "");
      const contentVersion = Number(request.body?.contentVersion);
      const vector = request.body?.vector;
      if (!memoryIdRaw || !organisationIdRaw || !Number.isInteger(contentVersion)) {
        validationError(response, "memoryId, organisationId, and contentVersion are required.");
        return;
      }
      assertN8nSafeId(memoryIdRaw, "memoryId");
      assertN8nSafeId(organisationIdRaw, "organisationId");
      const memoryId = asObjectId(memoryIdRaw);
      const organisationId = asObjectId(organisationIdRaw);
      if (!memoryId || !organisationId) {
        validationError(response, "Invalid memory or organisation id.");
        return;
      }
      if (!Array.isArray(vector) || vector.length !== (config.embeddingDimensions ?? 1024)) {
        validationError(response, "vector must contain the configured embedding dimensions.");
        return;
      }
      if (!vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
        validationError(response, "vector must contain finite numbers.");
        return;
      }

      const updated = await db.collection("memories").findOneAndUpdate(
        {
          _id: memoryId,
          organisationId,
          contentVersion,
        },
        {
          $set: {
            embedding: vector,
            embeddingStatus: "ready",
            embeddedAt: new Date(),
            updatedAt: new Date(),
          },
        },
        { returnDocument: "after" },
      );

      if (!updated) {
        response.json({ ok: true, stale: true });
        return;
      }
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/callbacks/handovers", async (request, response, next) => {
    try {
      const db = getDb();
      if (!db) {
        response.status(503).json({ success: false, error: { code: "UNAVAILABLE", message: "MongoDB unavailable." } });
        return;
      }
      const requestId = String(request.body?.requestId ?? "");
      const shiftIdRaw = String(request.body?.shiftId ?? "");
      const organisationIdRaw = String(request.body?.organisationId ?? "");
      const summaryMarkdown = String(request.body?.summaryMarkdown ?? "");
      const memoryIdsRaw = Array.isArray(request.body?.memoryIds)
        ? (request.body.memoryIds as unknown[]).map((item) => String(item))
        : [];

      if (!requestId || !shiftIdRaw || !organisationIdRaw || !summaryMarkdown.trim()) {
        validationError(response, "requestId, shiftId, organisationId, and summaryMarkdown are required.");
        return;
      }
      assertN8nSafeId(requestId, "requestId");
      assertN8nSafeId(shiftIdRaw, "shiftId");
      assertN8nSafeId(organisationIdRaw, "organisationId");

      const wf = await findWorkflowRequest(db, requestId);
      if (!wf || wf.type !== "shift_handover") {
        validationError(response, "Unknown handover request.");
        return;
      }
      if (wf.status === "completed") {
        response.json({ ok: true });
        return;
      }
      if (wf.status !== "pending") {
        validationError(response, "Request is not pending.");
        return;
      }
      if (
        toId(wf.shiftId) !== shiftIdRaw ||
        toId(wf.organisationId) !== organisationIdRaw
      ) {
        response.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Handover identifiers do not match the stored request." },
        });
        return;
      }

      const orgId = wf.organisationId as ObjectId;
      const shiftId = wf.shiftId as ObjectId;
      const keptMemoryIds = await filterRecordIds(
        db,
        memoryIdsRaw,
        orgId,
        null,
      );

      const now = new Date();
      await db.collection("handovers").insertOne({
        _id: new ObjectId(),
        organisationId: orgId,
        shiftId,
        requestId,
        summaryMarkdown: summaryMarkdown.trim(),
        summary: summaryMarkdown.trim(),
        memoryIds: keptMemoryIds.map((id) => asObjectId(id)).filter(Boolean),
        machineIds: [],
        constraintIds: [],
        title: "Shift handover",
        summaryKind: "generated",
        status: "published",
        createdBy: wf.userId,
        generatedAt: now,
        publishedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await completeWorkflowRequest(db, requestId, {
        summaryMarkdown: summaryMarkdown.trim(),
        memoryIds: keptMemoryIds,
      });

      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/callbacks/alerts", async (request, response, next) => {
    try {
      const db = getDb();
      if (!db) {
        response.status(503).json({ success: false, error: { code: "UNAVAILABLE", message: "MongoDB unavailable." } });
        return;
      }
      const eventId = String(request.body?.eventId ?? "");
      const organisationIdRaw = String(request.body?.organisationId ?? "");
      const severity = String(request.body?.severity ?? "");
      const title = String(request.body?.title ?? "").trim().slice(0, 120);
      const message = String(request.body?.message ?? "").trim().slice(0, 1000);
      const machineIdRaw = request.body?.machineId;

      if (!eventId || !organisationIdRaw || !title || !message) {
        validationError(response, "eventId, organisationId, title, and message are required.");
        return;
      }
      if (!["info", "warning", "critical"].includes(severity)) {
        validationError(response, "severity must be info, warning, or critical.");
        return;
      }
      assertN8nSafeId(eventId, "eventId");
      assertN8nSafeId(organisationIdRaw, "organisationId");
      const organisationId = asObjectId(organisationIdRaw);
      if (!organisationId) {
        validationError(response, "Invalid organisationId.");
        return;
      }
      let machineId: ObjectId | undefined;
      if (machineIdRaw !== null && machineIdRaw !== undefined && String(machineIdRaw).trim()) {
        assertN8nSafeId(String(machineIdRaw), "machineId");
        machineId = asObjectId(String(machineIdRaw)) ?? undefined;
      }

      const now = new Date();
      try {
        await db.collection("alerts").insertOne({
          _id: new ObjectId(),
          eventId,
          organisationId,
          machineId,
          severity,
          title,
          message,
          read: false,
          type: "workflow",
          status: "open",
          sourceType: "workflow",
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (error instanceof MongoServerError && error.code === 11000) {
          response.json({ ok: true });
          return;
        }
        throw error;
      }
      response.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  router.post("/internal/handover-data", async (request, response, next) => {
    try {
      const db = getDb();
      if (!db) {
        response.status(503).json({ success: false, error: { code: "UNAVAILABLE", message: "MongoDB unavailable." } });
        return;
      }
      const requestId = String(request.body?.requestId ?? "");
      const shiftIdRaw = String(request.body?.shiftId ?? "");
      const organisationIdRaw = String(request.body?.organisationId ?? "");
      if (!requestId || !shiftIdRaw || !organisationIdRaw) {
        validationError(response, "requestId, shiftId, and organisationId are required.");
        return;
      }
      assertN8nSafeId(requestId, "requestId");
      assertN8nSafeId(shiftIdRaw, "shiftId");
      assertN8nSafeId(organisationIdRaw, "organisationId");

      const wf = await findWorkflowRequest(db, requestId);
      if (
        !wf ||
        wf.type !== "shift_handover" ||
        wf.status !== "pending" ||
        toId(wf.shiftId) !== shiftIdRaw ||
        toId(wf.organisationId) !== organisationIdRaw
      ) {
        response.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Handover request mismatch." },
        });
        return;
      }

      const shiftId = wf.shiftId as ObjectId;
      const organisationId = wf.organisationId as ObjectId;
      const payload = await buildHandoverPayload(db, organisationId, shiftId);
      response.json(payload);
    } catch (error) {
      next(error);
    }
  });

  app.use(prefix, router);
}
