export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type NodeEnv = "development" | "test" | "production";

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  clientUrl: string;
  serverUrl: string;
  apiPrefix: string;
  mongodbUri: string | null;
  mongodbDatabase: string;
  authSecret: string | null;
  authTokenExpiresIn: string;
  googleClientId: string | null;
  googleClientSecret: string | null;
  aiProvider: string | null;
  aiApiKey: string | null;
  aiModel: string | null;
  embeddingProvider: string | null;
  embeddingApiKey: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number;
  embeddingBackfillDelayMs: number;
  /** Atlas Vector Search index on `memories.embedding`. */
  atlasVectorIndexName: string;
  speechProvider: string | null;
  speechApiKey: string | null;
  audioMaxBytes: number;
  /** @deprecated Legacy base URL; prefer explicit webhook URLs. */
  n8nBaseUrl: string | null;
  /** @deprecated Legacy shared secret; maps to callback/webhook key when new vars omitted. */
  n8nWebhookSecret: string | null;
  n8nWebhookKey: string | null;
  n8nCallbackSecret: string | null;
  n8nRequestTimeoutMs: number;
  n8nVoiceQuestionWebhookUrl: string | null;
  n8nWorkerReportWebhookUrl: string | null;
  n8nShiftHandoverWebhookUrl: string | null;
  n8nMemoryEmbeddingWebhookUrl: string | null;
  n8nAlertWebhookUrl: string | null;
  logLevel: string;
}

export interface IntegrationStatus {
  configured: boolean;
  status: "configured" | "unavailable";
}

export interface IntegrationReport {
  mongodb: IntegrationStatus;
  googleOAuth: IntegrationStatus;
  ai: IntegrationStatus;
  embeddings: IntegrationStatus;
  speech: IntegrationStatus;
  n8n: IntegrationStatus;
}

const PRODUCTION_REQUIRED = [
  "MONGODB_URI",
  "MONGODB_DATABASE",
  "AUTH_SECRET",
] as const;

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function requireNodeEnv(value: string | undefined): NodeEnv {
  const nodeEnv = (value?.trim() || "development") as string;
  if (nodeEnv === "development" || nodeEnv === "test" || nodeEnv === "production") {
    return nodeEnv;
  }
  throw new ConfigError(
    "NODE_ENV must be development, test, or production. The received value is not supported.",
  );
}

function joinWebhook(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/${path.replace(/^\/+/, "")}`;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = requireNodeEnv(source.NODE_ENV);
  const missing: string[] = [];

  if (nodeEnv === "production") {
    for (const key of PRODUCTION_REQUIRED) {
      if (!source[key]?.trim()) {
        missing.push(key);
      }
    }
  }

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(", ")}. Copy .env.example to .env and set them before starting in production. Secret values are not printed.`,
    );
  }

  const portValue = source.PORT?.trim() || "5000";
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be an integer between 1 and 65535.");
  }

  const audioRaw = source.AUDIO_MAX_BYTES?.trim() || "10485760";
  const audioMaxBytes = Number(audioRaw);
  if (!Number.isInteger(audioMaxBytes) || audioMaxBytes < 1) {
    throw new ConfigError("AUDIO_MAX_BYTES must be a positive integer.");
  }

  const dimensionsRaw = blankToNull(source.EMBEDDING_DIMENSIONS) ?? "1024";
  const embeddingDimensions = Number(dimensionsRaw);
  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1) {
    throw new ConfigError("EMBEDDING_DIMENSIONS must be a positive integer.");
  }

  const backfillRaw = blankToNull(source.EMBEDDING_BACKFILL_DELAY_MS) ?? "2500";
  const embeddingBackfillDelayMs = Number(backfillRaw);
  if (!Number.isInteger(embeddingBackfillDelayMs) || embeddingBackfillDelayMs < 0) {
    throw new ConfigError("EMBEDDING_BACKFILL_DELAY_MS must be a non-negative integer.");
  }

  const timeoutRaw = blankToNull(source.N8N_REQUEST_TIMEOUT_MS) ?? "90000";
  const n8nRequestTimeoutMs = Number(timeoutRaw);
  if (!Number.isInteger(n8nRequestTimeoutMs) || n8nRequestTimeoutMs < 1000) {
    throw new ConfigError("N8N_REQUEST_TIMEOUT_MS must be an integer of at least 1000.");
  }

  const renderUrl = blankToNull(source.RENDER_EXTERNAL_URL);
  const clientUrl =
    blankToNull(source.CLIENT_URL) ?? renderUrl ?? "http://localhost:5173";
  const serverUrl =
    blankToNull(source.SERVER_URL) ?? renderUrl ?? `http://localhost:${port}`;

  const legacyBase = blankToNull(source.N8N_BASE_URL);
  const legacySecret = blankToNull(source.N8N_WEBHOOK_SECRET);

  const n8nWebhookKey = blankToNull(source.N8N_WEBHOOK_KEY) ?? legacySecret;
  const n8nCallbackSecret =
    blankToNull(source.N8N_CALLBACK_SECRET) ?? legacySecret;

  const n8nVoiceQuestionWebhookUrl =
    blankToNull(source.N8N_VOICE_QUESTION_WEBHOOK_URL) ??
    (legacyBase ? joinWebhook(legacyBase, "webhook/echofloor-voice-question") : null);
  const n8nWorkerReportWebhookUrl =
    blankToNull(source.N8N_WORKER_REPORT_WEBHOOK_URL) ??
    (legacyBase ? joinWebhook(legacyBase, "webhook/echofloor-worker-report") : null);
  const n8nShiftHandoverWebhookUrl =
    blankToNull(source.N8N_SHIFT_HANDOVER_WEBHOOK_URL) ??
    (legacyBase ? joinWebhook(legacyBase, "webhook/echofloor-shift-handover") : null);
  const n8nMemoryEmbeddingWebhookUrl =
    blankToNull(source.N8N_MEMORY_EMBEDDING_WEBHOOK_URL) ??
    (legacyBase ? joinWebhook(legacyBase, "webhook/echofloor-memory-embedding") : null);
  const n8nAlertWebhookUrl =
    blankToNull(source.N8N_ALERT_WEBHOOK_URL) ??
    (legacyBase ? joinWebhook(legacyBase, "webhook/echofloor-alert-processing") : null);

  const voyageKey = blankToNull(source.VOYAGE_API_KEY);
  const embeddingProvider =
    blankToNull(source.EMBEDDING_PROVIDER) ?? (voyageKey ? "voyage" : null);
  const embeddingApiKey =
    blankToNull(source.EMBEDDING_API_KEY) ?? voyageKey ?? blankToNull(source.AI_API_KEY);
  const embeddingModel =
    blankToNull(source.EMBEDDING_MODEL) ??
    (embeddingProvider?.startsWith("voyage") ? "voyage-3-lite" : null);

  return {
    nodeEnv,
    port,
    clientUrl,
    serverUrl,
    apiPrefix: blankToNull(source.API_PREFIX) ?? "/api/v1",
    mongodbUri: blankToNull(source.MONGODB_URI),
    mongodbDatabase: blankToNull(source.MONGODB_DATABASE) ?? "echofloor",
    authSecret: blankToNull(source.AUTH_SECRET),
    authTokenExpiresIn: blankToNull(source.AUTH_TOKEN_EXPIRES_IN) ?? "8h",
    googleClientId: blankToNull(source.GOOGLE_CLIENT_ID),
    googleClientSecret: blankToNull(source.GOOGLE_CLIENT_SECRET),
    aiProvider: blankToNull(source.AI_PROVIDER),
    aiApiKey: blankToNull(source.AI_API_KEY),
    aiModel: blankToNull(source.AI_MODEL),
    embeddingProvider,
    embeddingApiKey,
    embeddingModel,
    embeddingDimensions,
    embeddingBackfillDelayMs,
    atlasVectorIndexName:
      blankToNull(source.ATLAS_VECTOR_INDEX_NAME) ?? "echofloor_memories_vector_index",
    speechProvider: blankToNull(source.SPEECH_PROVIDER),
    speechApiKey: blankToNull(source.SPEECH_API_KEY),
    audioMaxBytes,
    n8nBaseUrl: legacyBase,
    n8nWebhookSecret: legacySecret,
    n8nWebhookKey,
    n8nCallbackSecret,
    n8nRequestTimeoutMs,
    n8nVoiceQuestionWebhookUrl,
    n8nWorkerReportWebhookUrl,
    n8nShiftHandoverWebhookUrl,
    n8nMemoryEmbeddingWebhookUrl,
    n8nAlertWebhookUrl,
    logLevel: blankToNull(source.LOG_LEVEL) ?? "info",
  };
}

function flag(configured: boolean): IntegrationStatus {
  return configured
    ? { configured: true, status: "configured" }
    : { configured: false, status: "unavailable" };
}

export function isN8nIntegrationConfigured(config: AppConfig): boolean {
  return Boolean(
    config.n8nWebhookKey && config.n8nCallbackSecret && config.n8nVoiceQuestionWebhookUrl,
  );
}

export function integrationReport(config: AppConfig): IntegrationReport {
  return {
    mongodb: flag(Boolean(config.mongodbUri)),
    googleOAuth: flag(Boolean(config.googleClientId)),
    ai: flag(Boolean(config.aiProvider && config.aiApiKey && config.aiModel)),
    embeddings: flag(
      Boolean(
        config.embeddingModel && config.embeddingApiKey && config.embeddingDimensions,
      ),
    ),
    speech: flag(Boolean(config.speechProvider && config.speechApiKey)),
    n8n: flag(isN8nIntegrationConfigured(config)),
  };
}

export function missingOptionalNames(config: AppConfig): string[] {
  const report = integrationReport(config);
  const names: string[] = [];
  if (!report.mongodb.configured) names.push("MONGODB_URI");
  if (!config.authSecret) names.push("AUTH_SECRET");
  if (!report.googleOAuth.configured) names.push("GOOGLE_CLIENT_ID");
  if (!report.embeddings.configured) names.push("EMBEDDING_MODEL");
  if (!report.speech.configured) names.push("SPEECH_PROVIDER/SPEECH_API_KEY");
  if (!report.n8n.configured) {
    names.push("N8N_WEBHOOK_KEY/N8N_CALLBACK_SECRET/N8N_VOICE_QUESTION_WEBHOOK_URL");
  }
  return names;
}
