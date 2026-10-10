import type { AppConfig } from "../config/env.js";
import { assertN8nSafeId, newN8nEventId } from "../util/n8nIds.js";
import { emitAlertEvent } from "./alertEvents.js";
import { buildSearchableText } from "./buildSearchableText.js";
import { isN8nConfigured, postJson } from "./n8nClient.js";

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

export function triggerMemoryEmbedding(
  config: AppConfig,
  memoryId: string,
  organisationId: string,
  contentVersion: number,
  content: string,
): void {
  if (!isN8nConfigured(config) || !config.n8nMemoryEmbeddingWebhookUrl) return;
  const trimmed = content.trim();
  if (!trimmed || trimmed.length > 30000) return;

  try {
    assertN8nSafeId(memoryId, "memoryId");
    assertN8nSafeId(organisationId, "organisationId");
    void postJson(config, config.n8nMemoryEmbeddingWebhookUrl, {
      memoryId,
      organisationId,
      contentVersion,
      content: trimmed,
    }).catch(() => {
      /* fire-and-forget */
    });
  } catch {
    /* skip invalid ids */
  }
}
