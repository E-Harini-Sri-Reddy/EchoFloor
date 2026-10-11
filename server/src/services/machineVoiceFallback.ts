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

function safeId(value: unknown): string {
  try {
    return toId(value);
  } catch {
    return String(value ?? "");
  }
}

async function findByMachineId(
  db: Db,
  collectionName: string,
  machineId: ObjectId,
  organisationId: ObjectId,
  limit = 20,
): Promise<Record<string, unknown>[]> {
  const projection = { embedding: 0, photoDataUrl: 0 };
  const machineKey = toId(machineId);
  const orgKey = toId(organisationId);

  // Primary: machine id (+ org when present on the doc).
  const filters: Record<string, unknown>[] =
    collectionName === "machines"
      ? [{ _id: machineId, organisationId }, { _id: machineId }]
      : [
          { machineId, organisationId },
          { machineIdString: machineKey, organisationIdString: orgKey },
          { machineId },
          { machineIdString: machineKey },
        ];

  for (const filter of filters) {
    try {
      const rows = await db
        .collection(collectionName)
        .find(filter, { projection })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      if (rows.length > 0) return rows;
    } catch (error) {
      console.warn(
        `findByMachineId(${collectionName}) filter failed: ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
    }
  }
  return [];
}

/**
 * Guaranteed machine-scoped find across operational collections.
 * Used whenever vector search / embeddings / complex filters fail.
 */
export async function scanMachineById(
  db: Db,
  organisationId: ObjectId,
  machineId: ObjectId,
): Promise<{
  machine: Record<string, unknown> | null;
  alerts: Record<string, unknown>[];
  memories: Record<string, unknown>[];
  records: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  constraints: Record<string, unknown>[];
}> {
  const [machineRows, alerts, memories, records, tasks, constraints] =
    await Promise.all([
      findByMachineId(db, "machines", machineId, organisationId, 1),
      findByMachineId(db, "alerts", machineId, organisationId),
      findByMachineId(db, "memories", machineId, organisationId),
      findByMachineId(db, "records", machineId, organisationId),
      findByMachineId(db, "tasks", machineId, organisationId),
      findByMachineId(db, "constraints", machineId, organisationId),
    ]);

  return {
    machine: machineRows[0] ?? null,
    alerts,
    memories,
    records,
    tasks,
    constraints,
  };
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
    if (rows.length > 0) return rows;
  }
  return [];
}

function buildAnswerFromScan(
  machineCode: string,
  machineName: string,
  scan: Awaited<ReturnType<typeof scanMachineById>>,
  source: VoiceFallbackResult["source"],
): string {
  const { alerts, memories, records, tasks, constraints } = scan;
  const openAlerts = alerts.filter(
    (alert) => !["resolved", "dismissed"].includes(String(alert.status ?? "")),
  );
  const parts: string[] = [
    `For ${machineCode} (${machineName}), here is what MongoDB found for this machine${
      source === "vector_search" ? " via vector search" : " via direct lookup"
    }.`,
  ];

  const total =
    alerts.length + memories.length + records.length + tasks.length + constraints.length;
  if (total === 0) {
    parts.push("No documents were found for this machine id yet.");
    return parts.join(" ");
  }

  if (openAlerts.length > 0) {
    parts.push(
      `Open alerts (${openAlerts.length}): ${openAlerts
        .slice(0, 5)
        .map((a) => String(a.title ?? "Alert"))
        .join("; ")}.`,
    );
  } else if (alerts.length > 0) {
    parts.push(`Alerts on file (${alerts.length}), none currently open.`);
  }

  if (memories.length > 0) {
    parts.push(
      `Memories (${memories.length}): ${memories
        .slice(0, 5)
        .map((m) => String(m.title ?? m.summary ?? "Memory"))
        .join("; ")}.`,
    );
  }
  if (records.length > 0) {
    parts.push(
      `Search records (${records.length}): ${records
        .slice(0, 5)
        .map((r) => String(r.title ?? r.sourceType ?? "Record"))
        .join("; ")}.`,
    );
  }
  if (tasks.length > 0) {
    parts.push(
      `Tasks (${tasks.length}): ${tasks
        .slice(0, 4)
        .map((t) => String(t.title ?? "Task"))
        .join("; ")}.`,
    );
  }
  if (constraints.length > 0) {
    parts.push(
      `Constraints (${constraints.length}): ${constraints
        .slice(0, 4)
        .map((c) => String(c.title ?? c.description ?? "Constraint"))
        .join("; ")}.`,
    );
  }

  return parts.join(" ");
}

function buildEvidence(
  machineIdString: string,
  docs: Record<string, unknown>[],
): { evidence: VoiceFallbackEvidence[]; evidenceRecordIds: string[] } {
  const evidence: VoiceFallbackEvidence[] = [];
  const evidenceRecordIds: string[] = [];
  for (const doc of docs.slice(0, 12)) {
    const recordId = safeId(doc._id) || safeId(doc.sourceId);
    if (!recordId || evidenceRecordIds.includes(recordId)) continue;
    const text = snippet(doc);
    if (!text) continue;
    evidenceRecordIds.push(recordId);
    evidence.push({
      recordId,
      text,
      createdAt: asIso(doc.createdAt),
      machineId: machineIdString,
    });
  }
  return { evidence, evidenceRecordIds };
}

/**
 * Direct Mongo retrieval for voice Q&A.
 * Tries vector search first; on any error or empty result, falls back to find({ machineId }).
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
  const machineIdString = toId(input.machineId);
  const organisationIdString = toId(input.organisationId);

  try {
    let source: VoiceFallbackResult["source"] = "machine_scan";
    let vectorHits: Record<string, unknown>[] = [];

    try {
      const machine = await db.collection("machines").findOne({
        _id: input.machineId,
        organisationId: input.organisationId,
      });
      const machineCode = String(machine?.machineCode ?? "machine");
      const machineName = String(machine?.name ?? machineCode);
      const queryText =
        input.queryText?.trim() ||
        `Status, open issues, resolved issues, alerts, and history for machine ${machineCode} ${machineName}.`;

      const vector = await embedQueryText(config, queryText);
      if (vector && vector.length > 0) {
        vectorHits = await vectorSearchMemories(
          db,
          config,
          organisationIdString,
          machineIdString,
          vector,
        );
        if (vectorHits.length > 0) source = "vector_search";
      }
    } catch (error) {
      console.warn(
        `Voice vector path failed; using find(machineId): ${
          error instanceof Error ? error.message : "unknown"
        }`,
      );
      vectorHits = [];
      source = "machine_scan";
    }

    const scan = await scanMachineById(db, input.organisationId, input.machineId);
    const machineCode = String(scan.machine?.machineCode ?? "machine");
    const machineName = String(scan.machine?.name ?? machineCode);

    // Prefer vector hits for memories/records narrative when present; always merge alerts via find.
    const memoryLike =
      vectorHits.length > 0
        ? vectorHits
        : [...scan.memories, ...scan.records];

    const answer = buildAnswerFromScan(
      machineCode,
      machineName,
      {
        ...scan,
        memories: memoryLike.length > 0 ? memoryLike : scan.memories,
      },
      source,
    );

    const { evidence, evidenceRecordIds } = buildEvidence(machineIdString, [
      ...scan.alerts,
      ...memoryLike,
      ...scan.tasks,
      ...scan.constraints,
    ]);

    return { answer, evidence, evidenceRecordIds, source };
  } catch (error) {
    console.error(
      `answerMachineFromMongo crashed; hard find(machineId) fallback: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    const scan = await scanMachineById(db, input.organisationId, input.machineId);
    const machineCode = String(scan.machine?.machineCode ?? "machine");
    const machineName = String(scan.machine?.name ?? machineCode);
    const answer = buildAnswerFromScan(machineCode, machineName, scan, "machine_scan");
    const { evidence, evidenceRecordIds } = buildEvidence(machineIdString, [
      ...scan.alerts,
      ...scan.memories,
      ...scan.records,
      ...scan.tasks,
      ...scan.constraints,
    ]);
    return { answer, evidence, evidenceRecordIds, source: "machine_scan" };
  }
}
