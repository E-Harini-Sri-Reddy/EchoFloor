import type { AppConfig } from "../config/env.js";

export class N8nClientError extends Error {
  readonly statusCode: number | null;
  readonly code: string;

  constructor(message: string, code: string, statusCode: number | null = null) {
    super(message);
    this.name = "N8nClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function webhookKey(config: AppConfig): string {
  const key = config.n8nWebhookKey?.trim();
  if (!key) {
    throw new N8nClientError("n8n webhook key is not configured.", "UNAVAILABLE");
  }
  return key;
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function postJson(
  config: AppConfig,
  url: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.n8nRequestTimeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EchoFloor-Key": webhookKey(config),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      throw new N8nClientError(
        "n8n rejected the request.",
        "N8N_ERROR",
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof N8nClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new N8nClientError("n8n request timed out.", "TIMEOUT");
    }
    throw new N8nClientError("Could not reach n8n.", "UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export async function postMultipart(
  config: AppConfig,
  url: string,
  fields: Record<string, string>,
  audio: { buffer: Buffer; filename: string; mimetype: string },
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.n8nRequestTimeoutMs);
  try {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, value);
    }
    // Blob/File both work with undici FormData; Blob is more portable across Node versions.
    const bytes = Uint8Array.from(audio.buffer);
    const blob =
      typeof File !== "undefined"
        ? new File([bytes], audio.filename, {
            type: audio.mimetype || "application/octet-stream",
          })
        : new Blob([bytes], { type: audio.mimetype || "application/octet-stream" });
    form.append("audioFile", blob, audio.filename);

    console.info(
      `n8n multipart POST ${url} fields=${Object.keys(fields).join(",")} bytes=${audio.buffer.length}`,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-EchoFloor-Key": webhookKey(config),
      },
      body: form,
      signal: controller.signal,
    });
    const payload = await parseResponse(response);
    if (!response.ok) {
      const detail =
        typeof payload === "string"
          ? payload.slice(0, 200)
          : payload && typeof payload === "object" && "message" in payload
            ? String((payload as { message: unknown }).message).slice(0, 200)
            : "";
      console.error(
        `n8n multipart failed status=${response.status}${detail ? ` message=${detail}` : ""}`,
      );
      throw new N8nClientError(
        response.status === 403
          ? "n8n rejected the webhook key (check N8N_WEBHOOK_KEY matches n8n Header Auth)."
          : detail
            ? `n8n workflow error: ${detail}`
            : "n8n rejected the request.",
        "N8N_ERROR",
        response.status,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof N8nClientError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new N8nClientError("n8n request timed out.", "TIMEOUT");
    }
    console.error(
      `n8n multipart network error: ${error instanceof Error ? error.message : "unknown"}`,
    );
    throw new N8nClientError("Could not reach n8n.", "UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

export function isN8nConfigured(config: AppConfig): boolean {
  return Boolean(
    config.n8nWebhookKey &&
      config.n8nCallbackSecret &&
      config.n8nVoiceQuestionWebhookUrl,
  );
}
