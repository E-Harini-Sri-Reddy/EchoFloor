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
  aiProvider: string | null;
  aiApiKey: string | null;
  aiModel: string | null;
  embeddingProvider: string | null;
  embeddingApiKey: string | null;
  embeddingModel: string | null;
  embeddingDimensions: number | null;
  speechProvider: string | null;
  speechApiKey: string | null;
  audioMaxBytes: number;
  n8nBaseUrl: string | null;
  n8nWebhookSecret: string | null;
  logLevel: string;
}

export interface IntegrationStatus {
  configured: boolean;
  status: "configured" | "unavailable";
}

export interface IntegrationReport {
  mongodb: IntegrationStatus;
  ai: IntegrationStatus;
  embeddings: IntegrationStatus;
  speech: IntegrationStatus;
  n8n: IntegrationStatus;
}

const PRODUCTION_REQUIRED = [
  "PORT",
  "CLIENT_URL",
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

  const portValue = source.PORT?.trim() || (nodeEnv === "production" ? "" : "5000");
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT must be an integer between 1 and 65535.");
  }

  const audioRaw = source.AUDIO_MAX_BYTES?.trim() || "10485760";
  const audioMaxBytes = Number(audioRaw);
  if (!Number.isInteger(audioMaxBytes) || audioMaxBytes < 1) {
    throw new ConfigError("AUDIO_MAX_BYTES must be a positive integer.");
  }

  const dimensionsRaw = blankToNull(source.EMBEDDING_DIMENSIONS);
  let embeddingDimensions: number | null = null;
  if (dimensionsRaw) {
    embeddingDimensions = Number(dimensionsRaw);
    if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 1) {
      throw new ConfigError("EMBEDDING_DIMENSIONS must be a positive integer when set.");
    }
  }

  const clientUrl = blankToNull(source.CLIENT_URL) ?? "http://localhost:5173";
  const serverUrl = blankToNull(source.SERVER_URL) ?? `http://localhost:${port}`;

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
    aiProvider: blankToNull(source.AI_PROVIDER),
    aiApiKey: blankToNull(source.AI_API_KEY),
    aiModel: blankToNull(source.AI_MODEL),
    embeddingProvider: blankToNull(source.EMBEDDING_PROVIDER),
    embeddingApiKey: blankToNull(source.EMBEDDING_API_KEY),
    embeddingModel: blankToNull(source.EMBEDDING_MODEL),
    embeddingDimensions,
    speechProvider: blankToNull(source.SPEECH_PROVIDER),
    speechApiKey: blankToNull(source.SPEECH_API_KEY),
    audioMaxBytes,
    n8nBaseUrl: blankToNull(source.N8N_BASE_URL),
    n8nWebhookSecret: blankToNull(source.N8N_WEBHOOK_SECRET),
    logLevel: blankToNull(source.LOG_LEVEL) ?? "info",
  };
}

function flag(configured: boolean): IntegrationStatus {
  return configured
    ? { configured: true, status: "configured" }
    : { configured: false, status: "unavailable" };
}

export function integrationReport(config: AppConfig): IntegrationReport {
  const embeddingKey = config.embeddingApiKey ?? config.aiApiKey;
  return {
    mongodb: flag(Boolean(config.mongodbUri)),
    ai: flag(Boolean(config.aiProvider && config.aiApiKey && config.aiModel)),
    embeddings: flag(
      Boolean(config.embeddingModel && embeddingKey && config.embeddingDimensions),
    ),
    speech: flag(Boolean(config.speechProvider && config.speechApiKey)),
    n8n: flag(Boolean(config.n8nBaseUrl && config.n8nWebhookSecret)),
  };
}

export function missingOptionalNames(config: AppConfig): string[] {
  const report = integrationReport(config);
  const names: string[] = [];
  if (!report.mongodb.configured) names.push("MONGODB_URI");
  if (!config.authSecret) names.push("AUTH_SECRET");
  if (!report.ai.configured) names.push("AI_PROVIDER/AI_API_KEY/AI_MODEL");
  if (!report.embeddings.configured) names.push("EMBEDDING_MODEL");
  if (!report.speech.configured) names.push("SPEECH_PROVIDER/SPEECH_API_KEY");
  if (!report.n8n.configured) names.push("N8N_BASE_URL/N8N_WEBHOOK_SECRET");
  return names;
}
