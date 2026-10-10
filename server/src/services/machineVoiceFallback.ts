import type { Db, ObjectId } from "mongodb";
import type { AppConfig } from "../config/env.js";
import { toId } from "../db/ids.js";
import { embedQueryText } from "./embeddings.js";

export interface VoiceFallbackEvidence {
  recordId: string;
  text: string;
  createdAt: string;
  machineId: string;
}

export interface VoiceFallbackResult {
  answer: string;
  evidence: VoiceFallbackEvidence[];
  evidenceRecordIds: string[];
  source: "vector_search" | "machine_scan";
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value;
  return new Date().toISOString();
}

function snippet(doc: Record<string, unknown>, max = 280): string {
  const text = String(doc.text ?? doc.content ?? doc.summary ?? doc.message ?? doc.title ?? "");
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

async function vectorSearchOnCollection(
  db: Db,
  collectionName: string,
  indexName: string,
  organisationIdString: string,
  machineIdString: string,
  queryVector: number[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const project = {
    title: 1,
    content: 1,
    text: 1,
    summary: 1,
    status: 1,
    type: 1,
    tags: 1,
    createdAt: 1,
    machineId: 1,
    organisationId: 1,
    score: { $meta: "vectorSearchScore" as const },
  };
  const filters: Record<string, unknown>[] = [
    { organisationIdString, machineIdString },
    // Some Atlas indexes were created with the older filter field names.
    { organisationId: organisationIdString, machineId: machineIdString },
  ];

  for (const filter of filters) {
    try {
      const rows = await db
        .collection(collectionName)
        .aggregate([
          {
            $vectorSearch: {
              index: indexName,
              path: "embedding",
              queryVector,
              numCandidates: Math.max(limit * 10, 40),
              limit,
              filter,
            },
          },
          { $project: project },
        ])
        .toArray();
      if (rows.length > 0) return rows;
    } catch (error) {
      console.warn(
        `Atlas $vectorSearch failed (${collectionName}/${indexName}): ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }
  return [];
}

/**
 * Uses ATLAS_VECTOR_INDEX_NAME (default: echofloor_records_vector_index).
 * Prefers unified `records` (alerts/tasks/machines/memories/…), then `memories`.
 */
async function vectorSearchMemories(
  db: Db,
  config: AppConfig,
  organisationIdString: string,
  machineIdString: string,
  queryVector: number[],
  limit = 12,
): Promise<Record<string, unknown>[]> {
  const indexName = config.atlasVectorIndexName;
  for (const collectionName of ["records", "memories"] as const) {
    const rows = await vectorSearchOnCollection(
      db,
      collectionName,
      indexName,
      organisationIdString,
      machineIdString,
      queryVector,
      limit,
    );
    if (rows.length > 0) {
      console.info(
        `Voice Mongo fallback: vector hit on ${collectionName} via ${indexName} (${rows.length} docs).`,
      );
      return rows;
    }
  }
  return [];
}

async function scanMachineMemories(
  db: Db,
  organisationId: ObjectId,
  machineId: ObjectId,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  return db
    .collection("memories")
    .find(
      { organisationId, machineId },
      {
        projection: {
          title: 1,
          content: 1,
          text: 1,
          summary: 1,
          status: 1,
          type: 1,
          tags: 1,
          createdAt: 1,
          machineId: 1,
          embedding: 0,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

async function scanMachineAlerts(
  db: Db,
  organisationId: ObjectId,
  machineId: ObjectId,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  return db
    .collection("alerts")
    .find(
      { organisationId, machineId },
      {
        projection: {
          title: 1,
          message: 1,
          status: 1,
          severity: 1,
          issueKind: 1,
          type: 1,
          createdAt: 1,
          expiresAt: 1,
          machineId: 1,
        },
      },
    )
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

function buildAnswer(
  machineCode: string,
  machineName: string,
  memories: Record<string, unknown>[],
  alerts: Record<string, unknown>[],
  source: VoiceFallbackResult["source"],
): string {
  const openAlerts = alerts.filter(
    (alert) => !["resolved", "dismissed"].includes(String(alert.status ?? "")),
  );
  const resolvedAlerts = alerts.filter((alert) => String(alert.status ?? "") === "resolved");
  const unresolvedMemories = memories.filter((memory) =>
    ["unresolved", "pending_review"].includes(String(memory.status ?? "")),
  );
  const resolvedMemories = memories.filter((memory) =>
    ["resolved", "verified", "archived"].includes(String(memory.status ?? "")),
  );

  const parts: string[] = [
    `For ${machineCode} (${machineName}), here is what MongoDB retrieved${
      source === "vector_search" ? " via vector search" : ""
    }.`,
  ];

  if (openAlerts.length === 0 && memories.length === 0) {
    parts.push("No memories or alerts were found for this machine yet.");
    return parts.join(" ");
  }

  if (openAlerts.length > 0) {
    const lines = openAlerts.slice(0, 5).map((alert) => {
      const severity = String(alert.severity ?? "info");
      const title = String(alert.title ?? "Alert");
      const kind = alert.issueKind ? ` (${String(alert.issueKind)})` : "";
      return `${severity}: ${title}${kind}`;
    });
    parts.push(`Open issues/alerts (${openAlerts.length}): ${lines.join("; ")}.`);
  } else {
    parts.push("There are no open alerts on this machine right now.");
  }

  if (resolvedAlerts.length > 0) {
    const lines = resolvedAlerts.slice(0, 4).map((alert) => String(alert.title ?? "Resolved alert"));
    parts.push(`Resolved alerts (${resolvedAlerts.length}): ${lines.join("; ")}.`);
  }

  if (unresolvedMemories.length > 0) {
    const lines = unresolvedMemories
      .slice(0, 4)
      .map((memory) => String(memory.title ?? memory.summary ?? "Memory"));
    parts.push(`Open memory items (${unresolvedMemories.length}): ${lines.join("; ")}.`);
  }

  if (resolvedMemories.length > 0) {
    const lines = resolvedMemories
      .slice(0, 4)
      .map((memory) => String(memory.title ?? memory.summary ?? "Memory"));
    parts.push(`Resolved/verified history (${resolvedMemories.length}): ${lines.join("; ")}.`);
  }

  const extras = memories
    .filter(
      (memory) =>
        !unresolvedMemories.includes(memory) && !resolvedMemories.includes(memory),
    )
    .slice(0, 3)
    .map((memory) => String(memory.title ?? memory.summary ?? "Record"));
  if (extras.length > 0) {
    parts.push(`Related records: ${extras.join("; ")}.`);
  }

  return parts.join(" ");
}

/**
 * Direct Mongo retrieval for voice Q&A when n8n is down: Atlas vector search when
 * embeddings are available, otherwise a machine-scoped scan of memories + alerts.
 */
export async function answerMachineFromMongo(
  db: Db,
  config: AppConfig,
  input: {
    organisationId: ObjectId;
    machineId: ObjectId;
    queryText?: string;
  },
): Promise<VoiceFallbackResult> {
  const machine = await db.collection("machines").findOne({
    _id: input.machineId,
    organisationId: input.organisationId,
  });
  if (!machine) {
    return {
      answer: "Machine not found for this organisation.",
      evidence: [],
      evidenceRecordIds: [],
      source: "machine_scan",
    };
  }

  const machineCode = String(machine.machineCode ?? "machine");
  const machineName = String(machine.name ?? machineCode);
  const organisationIdString = toId(input.organisationId);
  const machineIdString = toId(input.machineId);
  const queryText =
    input.queryText?.trim() ||
    [
      `Status, open issues, resolved issues, alerts, maintenance, damage, overheating,`,
      `and history for machine ${machineCode} ${machineName}.`,
    ].join(" ");

  let memories: Record<string, unknown>[] = [];
  let source: VoiceFallbackResult["source"] = "machine_scan";

  try {
    const vector = await embedQueryText(config, queryText);
    if (vector && vector.length === config.embeddingDimensions) {
      memories = await vectorSearchMemories(
        db,
        config,
        organisationIdString,
        machineIdString,
        vector,
      );
      if (memories.length > 0) source = "vector_search";
    } else if (vector && vector.length > 0) {
      // Still try search if dimensions differ from config (index may match provider dims).
      memories = await vectorSearchMemories(
        db,
        config,
        organisationIdString,
        machineIdString,
        vector,
      );
      if (memories.length > 0) source = "vector_search";
    }
  } catch (error) {
    console.warn(
      `embedQueryText failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }

  if (memories.length === 0) {
    memories = await scanMachineMemories(db, input.organisationId, input.machineId);
    source = "machine_scan";
  }

  const alerts = await scanMachineAlerts(db, input.organisationId, input.machineId);
  const answer = buildAnswer(machineCode, machineName, memories, alerts, source);

  const evidence: VoiceFallbackEvidence[] = [];
  const evidenceRecordIds: string[] = [];

  for (const alert of alerts.slice(0, 8)) {
    const recordId = toId(alert._id);
    evidenceRecordIds.push(recordId);
    evidence.push({
      recordId,
      text: snippet(alert),
      createdAt: asIso(alert.createdAt),
      machineId: machineIdString,
    });
  }
  for (const memory of memories.slice(0, 8)) {
    const recordId = toId(memory._id);
    if (evidenceRecordIds.includes(recordId)) continue;
    evidenceRecordIds.push(recordId);
    evidence.push({
      recordId,
      text: snippet(memory),
      createdAt: asIso(memory.createdAt),
      machineId: machineIdString,
    });
  }

  return { answer, evidence, evidenceRecordIds, source };
}
