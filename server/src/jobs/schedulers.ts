import cron from "node-cron";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { emitAlertEvent } from "../services/alertEvents.js";
import { buildSearchableText } from "../services/buildSearchableText.js";
import { triggerMemoryEmbedding } from "../services/memoryEmbedding.js";
import {
  embedAndUpsertSource,
  SOURCE_COLLECTIONS,
  type SearchSourceType,
} from "../services/searchRecords.js";
import { newN8nEventId } from "../util/n8nIds.js";
import type { ObjectId } from "mongodb";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function startSchedulers(config: AppConfig): void {
  if (!getDb()) return;

  cron.schedule("*/5 * * * *", () => {
    void sweepConstraintAlerts(config);
    void sweepExpiredOperationalData(config);
    void sweepStaleEmbeddings(config);
    void sweepStaleWorkflowRequests();
  });
}

/**
 * Close expired alerts/constraints so Live Alerts and AI retrieval stop treating
 * short-lived holds (e.g. 2h shutdown) as current. TTL indexes delete expired
 * alert/constraint documents; this pass updates status and refreshes memory text
 * + embeddings so vector search no longer ranks them as active.
 */
async function sweepExpiredOperationalData(config: AppConfig) {
  const db = getDb();
  if (!db) return;
  const now = new Date();

  const expiredConstraints = await db
    .collection("constraints")
    .find({
      status: "active",
      expiresAt: { $lte: now, $type: "date" },
    })
    .limit(200)
    .toArray();

  for (const row of expiredConstraints) {
    await db.collection("constraints").updateOne(
      { _id: row._id },
      { $set: { status: "expired", updatedAt: now } },
    );
    const sourceMemoryId = row.sourceMemoryId
      ? asObjectId(String(toId(row.sourceMemoryId)))
      : null;
    if (sourceMemoryId) {
      await markMemoryHoldEnded(config, sourceMemoryId, "constraint_expired");
    }
  }

  const expiredAlerts = await db
    .collection("alerts")
    .find({
      status: { $in: ["open", "acknowledged"] },
      expiresAt: { $lte: now, $type: "date" },
    })
    .limit(200)
    .toArray();

  for (const row of expiredAlerts) {
    await db.collection("alerts").updateOne(
      { _id: row._id },
      {
        $set: {
          status: "resolved",
          resolvedAt: now,
          updatedAt: now,
        },
      },
    );
    const sourceId = row.sourceId ? asObjectId(String(toId(row.sourceId))) : null;
    if (sourceId) {
      await markMemoryHoldEnded(config, sourceId, "alert_window_ended");
    }
  }
}

async function markMemoryHoldEnded(
  config: AppConfig,
  memoryId: ObjectId,
  reason: string,
) {
  const db = getDb();
  if (!db || !memoryId) return;
  const memory = await db.collection("memories").findOne({ _id: memoryId });
  if (!memory) return;
  if (memory.operationalHoldEndedAt) return;

  const note = `Operational hold ended (${reason}) at ${new Date().toISOString()}. This item is historical and must not be treated as an active machine restriction.`;
  const baseText =
    String(memory.text ?? "").trim() ||
    buildSearchableText(memory as Record<string, unknown>);
  const text = `${baseText}\n\n${note}`.slice(0, 30000);
  const contentVersion = Number(memory.contentVersion ?? 1) + 1;

  await db.collection("memories").updateOne(
    { _id: memoryId },
    {
      $set: {
        text,
        contentVersion,
        embeddingStatus: "pending",
        operationalHoldEndedAt: new Date(),
        updatedAt: new Date(),
      },
      $unset: { embedding: "", embeddedAt: "" },
    },
  );

  triggerMemoryEmbedding(
    config,
    toId(memoryId),
    toId(memory.organisationId),
    contentVersion,
    text,
  );
}

async function sweepConstraintAlerts(config: AppConfig) {
  const db = getDb();
  if (!db) return;
  const now = new Date();
  const horizon = new Date(now.getTime() + TWO_HOURS_MS);
  const rows = await db
    .collection("constraints")
    .find({
      status: "active",
      expiresAt: { $gt: now, $lte: horizon },
    })
    .limit(200)
    .toArray();

  for (const row of rows) {
    const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : null;
    if (!expiresAt) continue;
    const constraintId = toId(row._id);
    const organisationId = toId(row.organisationId);
    const machineId = row.machineId ? toId(row.machineId) : null;
    const eventId = newN8nEventId("constraint-expiring", [
      constraintId,
      String(expiresAt.getTime()),
    ]);
    emitAlertEvent(config, {
      eventId,
      organisationId,
      machineId,
      eventType: "constraint_expiring",
      eventDetails: {
        constraintId,
        expiresAt: expiresAt.toISOString(),
        description: String(row.description ?? row.title ?? "").slice(0, 500),
      },
    });
  }
}

async function sweepStaleEmbeddings(config: AppConfig) {
  const db = getDb();
  if (!db) return;

  // Sync a batch from every operational collection into unified `records`.
  for (const { sourceType, collection } of SOURCE_COLLECTIONS) {
    await syncCollectionToRecords(config, sourceType, collection);
  }

  // Keep legacy memory pending retry for n8n-only setups.
  const cutoff = new Date(Date.now() - TEN_MINUTES_MS);
  const rows = await db
    .collection("memories")
    .find({
      $and: [
        {
          $or: [
            { embedding: { $exists: false } },
            { embedding: null },
            { embeddingStatus: { $in: ["pending", "failed"] } },
            { embeddingStatus: { $exists: false } },
          ],
        },
        {
          $or: [
            { embeddingAttempts: { $exists: false } },
            { embeddingAttempts: { $lt: 3 } },
          ],
        },
        {
          $or: [
            { embeddingAttempts: { $exists: false } },
            { embeddingAttempts: 0 },
            { updatedAt: { $lte: cutoff } },
          ],
        },
      ],
    })
    .sort({ updatedAt: 1 })
    .limit(20)
    .toArray();

  for (const memory of rows) {
    const attempts = Number(memory.embeddingAttempts ?? 0) + 1;
    if (attempts > 3) {
      await db.collection("memories").updateOne(
        { _id: memory._id },
        { $set: { embeddingStatus: "failed", embeddingAttempts: attempts, updatedAt: new Date() } },
      );
      continue;
    }
    const text =
      String(memory.text ?? "").trim() ||
      buildSearchableText(memory as Record<string, unknown>);
    if (!text) continue;
    const contentVersion = Number(memory.contentVersion ?? 1);
    const organisationId = memory.organisationId;
    await db.collection("memories").updateOne(
      { _id: memory._id },
      {
        $set: {
          embeddingStatus: "pending",
          embeddingAttempts: attempts,
          updatedAt: new Date(),
          text,
          contentVersion,
        },
      },
    );
    triggerMemoryEmbedding(
      config,
      toId(memory._id),
      toId(organisationId),
      contentVersion,
      text,
    );
  }
}

async function syncCollectionToRecords(
  config: AppConfig,
  sourceType: SearchSourceType,
  collection: string,
) {
  const db = getDb();
  if (!db) return;

  const readySourceIds = await db.collection("records").distinct("sourceId", {
    sourceType,
    embeddingStatus: "ready",
    embedding: { $exists: true, $ne: null },
  });
  const sources = await db
    .collection(collection)
    .find({ _id: { $nin: readySourceIds } })
    .sort({ updatedAt: 1, createdAt: 1 })
    .limit(12)
    .toArray();

  for (const source of sources) {
    await embedAndUpsertSource(
      db,
      config,
      sourceType,
      source as Record<string, unknown>,
    );
  }
}

async function sweepStaleWorkflowRequests() {
  const db = getDb();
  if (!db) return;
  const cutoff = new Date(Date.now() - FIVE_MINUTES_MS);
  await db.collection("workflow_requests").updateMany(
    { status: "pending", createdAt: { $lte: cutoff } },
    {
      $set: {
        status: "failed",
        errorMessage: "Timed out waiting for workflow callback.",
        completedAt: new Date(),
      },
    },
  );
}
