import type { AppConfig } from "../config/env.js";
import { assertN8nSafeId } from "../util/n8nIds.js";
import { isN8nConfigured, postJson } from "./n8nClient.js";

const EVENT_TYPE_PATTERN = /^[A-Za-z0-9_\-:. ]{1,64}$/;

export interface AlertEventInput {
  eventId: string;
  organisationId: string;
  machineId?: string | null;
  eventType: string;
  eventDetails: Record<string, unknown> | string;
}

function trimEventDetails(details: Record<string, unknown> | string): Record<string, unknown> | string {
  const serialized =
    typeof details === "string" ? details : JSON.stringify(details);
  if (serialized.length <= 20000) {
    return details;
  }
  if (typeof details === "string") {
    return details.slice(0, 20000);
  }
  return { note: "eventDetails truncated", preview: serialized.slice(0, 20000) };
}

/**
 * Fire-and-forget alert processing workflow (workflow E).
 */
export function emitAlertEvent(config: AppConfig, input: AlertEventInput): void {
  if (!isN8nConfigured(config) || !config.n8nAlertWebhookUrl) return;

  try {
    assertN8nSafeId(input.eventId, "eventId");
    assertN8nSafeId(input.organisationId, "organisationId");
    if (input.machineId) assertN8nSafeId(input.machineId, "machineId");
    if (!EVENT_TYPE_PATTERN.test(input.eventType.trim())) return;

    const body: Record<string, unknown> = {
      eventId: input.eventId,
      organisationId: input.organisationId,
      eventType: input.eventType.trim(),
      eventDetails: trimEventDetails(input.eventDetails),
    };
    if (input.machineId) body.machineId = input.machineId;

    void postJson(config, config.n8nAlertWebhookUrl, body).catch(() => {
      /* fire-and-forget */
    });
  } catch {
    /* invalid ids — skip */
  }
}
