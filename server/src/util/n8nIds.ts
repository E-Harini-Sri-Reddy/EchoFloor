const N8N_SAFE_ID = /^[A-Za-z0-9_\-:.]{1,128}$/;

export class N8nIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "N8nIdError";
  }
}

export function assertN8nSafeId(id: string, label = "id"): string {
  const trimmed = id.trim();
  if (!N8N_SAFE_ID.test(trimmed)) {
    throw new N8nIdError(`${label} is not a valid n8n-safe identifier.`);
  }
  return trimmed;
}

export function newN8nRequestId(): string {
  return assertN8nSafeId(crypto.randomUUID(), "requestId");
}

export function newN8nEventId(prefix: string, parts: string[]): string {
  return assertN8nSafeId(`${prefix}:${parts.join(":")}`, "eventId");
}
