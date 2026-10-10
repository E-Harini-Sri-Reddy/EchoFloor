import type { Db, ObjectId } from "mongodb";
import type { AppConfig } from "../config/env.js";
import { toId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { buildSearchableText } from "./buildSearchableText.js";
import {
  embedDocumentText,
  persistMemoryEmbedding,
  resolveEmbeddingAuth,
} from "./embeddings.js";

/** Unified collection targeted by echofloor_records_vector_index. */
export const SEARCH_RECORDS_COLLECTION = "records";

export type SearchSourceType =
  | "memory"
  | "alert"
  | "constraint"
  | "task"
  | "machine"
  | "handover";

export interface SearchRecordDoc {
  sourceType: SearchSourceType;
  sourceId: ObjectId;
  organisationId: ObjectId;
  machineId?: ObjectId;
  organisationIdString: string;
  machineIdString?: string;
  title: string;
  text: string;
  content: string;
  summary?: string;
  status?: string;
  type?: string;
  tags: string[];
  embedding?: number[];
  embeddingStatus: "pending" | "ready" | "failed";
  embeddingAttempts?: number;
  contentVersion: number;
  createdAt: Date;
  updatedAt: Date;
  embeddedAt?: Date;
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildRecordFromSource(
  sourceType: SearchSourceType,
  doc: Record<string, unknown>,
): Omit<SearchRecordDoc, "embedding" | "embeddingStatus" | "embeddingAttempts" | "embeddedAt"> | null {
  const organisationId = doc.organisationId as ObjectId | undefined;
  const sourceId = doc._id as ObjectId | undefined;
  if (!organisationId || !sourceId) return null;

  const machineId = (doc.machineId as ObjectId | undefined) ?? undefined;
  const now = new Date();
  const createdAt =
    doc.createdAt instanceof Date ? doc.createdAt : now;
  const orgString = toId(organisationId);

  let title = "";
  let content = "";
  let summary = "";
  let status = cleanText(doc.status) || undefined;
  let type = cleanText(doc.type) || sourceType;
  const tags: string[] = [sourceType];

  switch (sourceType) {
    case "memory": {
      title = cleanText(doc.title) || "Memory";
      content =
        cleanText(doc.text) ||
        buildSearchableText(doc) ||
        cleanText(doc.content);
      summary = cleanText(doc.summary).slice(0, 200);
      if (Array.isArray(doc.tags)) {
        for (const tag of doc.tags) {
          const value = cleanText(tag);
          if (value) tags.push(value);
        }
      }
      break;
    }
    case "alert": {
      title = cleanText(doc.title) || "Alert";
      const kind = cleanText(doc.issueKind);
      content = [
        `Alert: ${title}`,
        kind ? `Issue kind: ${kind}` : "",
        cleanText(doc.message),
        status ? `Status: ${status}` : "",
        cleanText(doc.severity) ? `Severity: ${cleanText(doc.severity)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      summary = cleanText(doc.message).slice(0, 200);
      type = cleanText(doc.type) || "alert";
      if (kind) tags.push(kind);
      tags.push(cleanText(doc.severity) || "info");
      break;
    }
    case "constraint": {
      title = cleanText(doc.title) || cleanText(doc.description) || "Constraint";
      content = [
        `Constraint: ${title}`,
        cleanText(doc.description),
        status ? `Status: ${status}` : "",
        doc.expiresAt ? `Expires: ${asIso(doc.expiresAt)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      summary = cleanText(doc.description).slice(0, 200) || title;
      break;
    }
    case "task": {
      title = cleanText(doc.title) || "Task";
      content = [
        `Task: ${title}`,
        cleanText(doc.description),
        status ? `Status: ${status}` : "",
        cleanText(doc.priority) ? `Priority: ${cleanText(doc.priority)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      summary = cleanText(doc.description).slice(0, 200) || title;
      tags.push(cleanText(doc.priority) || "normal");
      break;
    }
    case "machine": {
      title = `${cleanText(doc.machineCode) || "Machine"} — ${cleanText(doc.name) || "unnamed"}`;
      const location = (doc.location as Record<string, unknown> | undefined) ?? {};
      content = [
        `Machine: ${title}`,
        cleanText(doc.description),
        cleanText(doc.machineType) ? `Type: ${cleanText(doc.machineType)}` : "",
        status ? `Status: ${status}` : "",
        cleanText(location.productionLine)
          ? `Line: ${cleanText(location.productionLine)}`
          : "",
        cleanText(location.area) ? `Area: ${cleanText(location.area)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      summary = cleanText(doc.description).slice(0, 200) || title;
      // machines use _id as machineId for filtering
      break;
    }
    case "handover": {
      title = cleanText(doc.title) || "Shift handover";
      content = [
        `Handover: ${title}`,
        cleanText(doc.summary),
        status ? `Status: ${status}` : "",
      ]
        .filter(Boolean)
        .join(". ");
      summary = cleanText(doc.summary).slice(0, 200) || title;
      break;
    }
  }

  if (!content) return null;

  const resolvedMachineId =
    sourceType === "machine" ? sourceId : machineId;

  return {
    sourceType,
    sourceId,
    organisationId,
    ...(resolvedMachineId ? { machineId: resolvedMachineId } : {}),
    organisationIdString: orgString,
    ...(resolvedMachineId ? { machineIdString: toId(resolvedMachineId) } : {}),
    title,
    text: content,
    content,
    summary: summary || title.slice(0, 200),
    status,
    type,
    tags: [...new Set(tags.filter(Boolean))],
    contentVersion: Number(doc.contentVersion ?? 1),
    createdAt,
    updatedAt: now,
  };
}

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return cleanText(value);
}

export async function upsertSearchRecord(
  db: Db,
  record: Omit<
    SearchRecordDoc,
    "embedding" | "embeddingStatus" | "embeddingAttempts" | "embeddedAt"
  > &
    Partial<Pick<SearchRecordDoc, "embedding" | "embeddingStatus" | "embeddedAt">>,
): Promise<ObjectId> {
  const filter = {
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    organisationId: record.organisationId,
  };
  const existing = await db.collection(SEARCH_RECORDS_COLLECTION).findOne(filter);
  const setDoc = {
    ...record,
    embeddingStatus: record.embeddingStatus ?? (record.embedding ? "ready" : "pending"),
    updatedAt: new Date(),
  };
  if (existing) {
    await db.collection(SEARCH_RECORDS_COLLECTION).updateOne(
      { _id: existing._id },
      {
        $set: setDoc,
        ...(record.embedding
          ? { $unset: { embeddingAttempts: "" } }
          : {}),
      },
    );
    return existing._id as ObjectId;
  }
  const insert = {
    ...setDoc,
    createdAt: record.createdAt ?? new Date(),
  };
  const result = await db.collection(SEARCH_RECORDS_COLLECTION).insertOne(insert);
  return result.insertedId;
}

/** Embed one source document and upsert into `records` (+ memories.embedding when source is memory). */
export async function embedAndUpsertSource(
  db: Db,
  config: AppConfig,
  sourceType: SearchSourceType,
  doc: Record<string, unknown>,
): Promise<{ ok: boolean; recordId?: ObjectId }> {
  const base = buildRecordFromSource(sourceType, doc);
  if (!base) return { ok: false };
  if (!resolveEmbeddingAuth(config)) {
    const recordId = await upsertSearchRecord(db, {
      ...base,
      embeddingStatus: "pending",
    });
    return { ok: false, recordId };
  }

  try {
    const vector = await embedDocumentText(config, base.text);
    if (!vector?.length) {
      const recordId = await upsertSearchRecord(db, {
        ...base,
        embeddingStatus: "failed",
      });
      return { ok: false, recordId };
    }

    const recordId = await upsertSearchRecord(db, {
      ...base,
      embedding: vector,
      embeddingStatus: "ready",
      embeddedAt: new Date(),
    });

    if (sourceType === "memory") {
      await persistMemoryEmbedding(db, {
        memoryId: base.sourceId,
        organisationId: base.organisationId,
        contentVersion: base.contentVersion,
        vector,
      });
    }

    return { ok: true, recordId };
  } catch (error) {
    console.warn(
      `embedAndUpsertSource(${sourceType}/${toId(base.sourceId)}) failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
    const recordId = await upsertSearchRecord(db, {
      ...base,
      embeddingStatus: "failed",
    });
    return { ok: false, recordId };
  }
}

export function triggerSourceEmbedding(
  config: AppConfig,
  sourceType: SearchSourceType,
  doc: Record<string, unknown>,
): void {
  const db = getDb();
  if (!db) return;
  void embedAndUpsertSource(db, config, sourceType, doc).catch((error: unknown) => {
    console.warn(
      `triggerSourceEmbedding failed: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  });
}

export const SOURCE_COLLECTIONS: Array<{
  sourceType: SearchSourceType;
  collection: string;
}> = [
  { sourceType: "memory", collection: "memories" },
  { sourceType: "alert", collection: "alerts" },
  { sourceType: "constraint", collection: "constraints" },
  { sourceType: "task", collection: "tasks" },
  { sourceType: "machine", collection: "machines" },
  { sourceType: "handover", collection: "handovers" },
];
