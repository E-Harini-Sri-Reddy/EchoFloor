import type { AppConfig } from "../config/env.js";
import { asObjectId } from "../db/ids.js";
import { getDb } from "../db/mongo.js";
import { assertN8nSafeId, newN8nEventId } from "../util/n8nIds.js";
import { emitAlertEvent } from "./alertEvents.js";
import { buildSearchableText } from "./buildSearchableText.js";
import {
  embedDocumentText,
  persistMemoryEmbedding,
  resolveEmbeddingAuth,
} from "./embeddings.js";
import { isN8nConfigured, postJson } from "./n8nClient.js";
import { embedAndUpsertSource } from "./searchRecords.js";

/** Apply when an admin edit succeeds (increment version, rebuild text, clear stale vectors). */
export function memoryFieldsAfterContentEdit(
  memory: Record<string, unknown>,
  options?: { machineName?: string },
): {
  text: string;
  contentVersion: number;
  embeddingStatus: "pending";
  organisationIdString?: string;
  machineIdString?: string;
} {
  const nextVersion = Number(memory.contentVersion ?? 1) + 1;
  const text = buildSearchableText(memory, options);
  const orgString =
    typeof memory.organisationIdString === "string"
      ? memory.organisationIdString
      : undefined;
  const machineString =
    typeof memory.machineIdString === "string" ? memory.machineIdString : undefined;
  return {
    text,
    contentVersion: nextVersion,
    embeddingStatus: "pending",
    organisationIdString: orgString,
    machineIdString: machineString,
  };
}

export function emitMemoryEditedAlert(
  config: AppConfig,
  memoryId: string,
  organisationId: string,
  machineId: string | null,
  contentVersion: number,
): void {
  emitAlertEvent(config, {
    eventId: newN8nEventId("memory-edited", [memoryId, String(contentVersion)]),
    organisationId,
    machineId,
    eventType: "memory_edited",
    eventDetails: { memoryId, contentVersion },
  });
}

async function embedMemoryOnServer(
  config: AppConfig,
  memoryId: string,
  organisationId: string,
  contentVersion: number,
  content: string,
): Promise<boolean> {
  const db = getDb();
  if (!db || !resolveEmbeddingAuth(config)) return false;

  // Prefer unified records upsert (also writes memories.embedding).
  const memoryObjectId = asObjectId(memoryId);
  const organisationObjectId = asObjectId(organisationId);
  if (memoryObjectId && organisationObjectId) {
    const memory = await db.collection("memories").findOne({
      _id: memoryObjectId,
      organisationId: organisationObjectId,
    });
    if (memory) {
      const synced = await embedAndUpsertSource(db, config, "memory", {
        ...memory,
        text: content,
        contentVersion,
      } as Record<string, unknown>);
      if (synced.ok) return true;
    }
  }

  const vector = await embedDocumentText(config, content);
  if (!vector || vector.length === 0) return false;
  if (vector.length !== config.embeddingDimensions) {
    console.warn(
      `Embedding length ${vector.length} does not match EMBEDDING_DIMENSIONS=${config.embeddingDimensions}; storing anyway if Atlas index matches.`,
    );
  }
  return persistMemoryEmbedding(db, {
    memoryId,
    organisationId,
    contentVersion,
    vector,
  });
}

/**
 * Create/refresh a memory embedding.
 * Prefers a direct OpenAI/Voyage call from the Express API when keys are set;
 * otherwise falls back to the n8n memory-embedding webhook.
 */
export function triggerMemoryEmbedding(
  config: AppConfig,
  memoryId: string,
  organisationId: string,
  contentVersion: number,
  content: string,
): void {
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 30000) return;

  try {
    assertN8nSafeId(memoryId, "memoryId");
    assertN8nSafeId(organisationId, "organisationId");
  } catch {
    return;
  }

  const hasDirectEmbeddings = Boolean(resolveEmbeddingAuth(config));
  if (hasDirectEmbeddings) {
    void embedMemoryOnServer(
      config,
      memoryId,
      organisationId,
      contentVersion,
      trimmed,
    )
      .then((ok) => {
        if (!ok) {
          console.warn(
            `Direct embedding did not update memory ${memoryId}; trying n8n if configured.`,
          );
          triggerN8nMemoryEmbedding(
            config,
            memoryId,
            organisationId,
            contentVersion,
            trimmed,
          );
        }
      })
      .catch((error: unknown) => {
        console.warn(
          `Direct embedding failed for ${memoryId}: ${
            error instanceof Error ? error.message : "unknown"
          }`,
        );
        triggerN8nMemoryEmbedding(
          config,
          memoryId,
          organisationId,
          contentVersion,
          trimmed,
        );
      });
    return;
  }

  triggerN8nMemoryEmbedding(
    config,
    memoryId,
    organisationId,
    contentVersion,
    trimmed,
  );
}

function triggerN8nMemoryEmbedding(
  config: AppConfig,
  memoryId: string,
  organisationId: string,
  contentVersion: number,
  content: string,
): void {
  if (!isN8nConfigured(config) || !config.n8nMemoryEmbeddingWebhookUrl) return;
  void postJson(config, config.n8nMemoryEmbeddingWebhookUrl, {
    memoryId,
    organisationId,
    contentVersion,
    content,
  }).catch(() => {
    /* fire-and-forget */
  });
}
