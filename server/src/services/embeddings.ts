import { ObjectId, type Db } from "mongodb";
import type { AppConfig } from "../config/env.js";
import { asObjectId, toId } from "../db/ids.js";

export class EmbeddingClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingClientError";
  }
}

export function resolveEmbeddingAuth(config: AppConfig): {
  provider: string;
  apiKey: string;
  model: string;
} | null {
  const voyageKey = process.env.VOYAGE_API_KEY?.trim() || "";
  const apiKey =
    config.embeddingApiKey?.trim() ||
    voyageKey ||
    config.aiApiKey?.trim() ||
    "";
  if (!apiKey) return null;

  let provider = (config.embeddingProvider ?? "").trim().toLowerCase();
  if (!provider) {
    if (config.aiProvider?.trim()) {
      provider = config.aiProvider.trim().toLowerCase();
    } else if (voyageKey && !config.embeddingApiKey?.trim()) {
      provider = "voyage";
    } else {
      provider = "openai";
    }
  }

  let model = (config.embeddingModel ?? "").trim();
  if (!model) {
    model = provider.startsWith("voyage")
      ? "voyage-3-lite"
      : "text-embedding-3-small";
  }

  return { provider, apiKey, model };
}

async function requestEmbedding(
  config: AppConfig,
  text: string,
  inputType: "query" | "document",
): Promise<number[] | null> {
  const auth = resolveEmbeddingAuth(config);
  if (!auth) return null;
  const input = text.trim().slice(0, 8000);
  if (!input) return null;

  if (auth.provider.startsWith("voyage")) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify({
        input: [input],
        model: auth.model,
        input_type: inputType,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      throw new EmbeddingClientError(
        `Voyage embedding failed (${response.status})${detail ? `: ${detail}` : ""}`,
      );
    }
    const body = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = body.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new EmbeddingClientError("Voyage embedding response was empty.");
    }
    return vector;
  }

  const base =
    auth.provider === "groq"
      ? "https://api.groq.com/openai/v1/embeddings"
      : "https://api.openai.com/v1/embeddings";
  const body: Record<string, unknown> = {
    input,
    model: auth.model,
  };
  // text-embedding-3-* supports shortening to match Atlas index dims (default 1024).
  if (auth.model.startsWith("text-embedding-3")) {
    body.dimensions = config.embeddingDimensions;
  }

  const response = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new EmbeddingClientError(
      `Embedding API failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const payload = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new EmbeddingClientError("Embedding response was empty.");
  }
  return vector;
}

/** Embed a search query for Atlas Vector Search. */
export async function embedQueryText(
  config: AppConfig,
  text: string,
): Promise<number[] | null> {
  return requestEmbedding(config, text, "query");
}

/** Embed memory/document text before storing on the memory document. */
export async function embedDocumentText(
  config: AppConfig,
  text: string,
): Promise<number[] | null> {
  return requestEmbedding(config, text, "document");
}

/** Write an embedding onto a memory document (same shape as the n8n callback). */
export async function persistMemoryEmbedding(
  db: Db,
  input: {
    memoryId: string | ObjectId;
    organisationId: string | ObjectId;
    contentVersion: number;
    vector: number[];
  },
): Promise<boolean> {
  const memoryId =
    typeof input.memoryId === "string" ? asObjectId(input.memoryId) : input.memoryId;
  const organisationId =
    typeof input.organisationId === "string"
      ? asObjectId(input.organisationId)
      : input.organisationId;
  if (!memoryId || !organisationId) return false;

  const updated = await db.collection("memories").findOneAndUpdate(
    {
      _id: memoryId,
      organisationId,
      contentVersion: input.contentVersion,
    },
    {
      $set: {
        embedding: input.vector,
        embeddingStatus: "ready",
        embeddedAt: new Date(),
        updatedAt: new Date(),
        organisationIdString: toId(organisationId),
      },
      $unset: { embeddingAttempts: "" },
    },
    { returnDocument: "after" },
  );
  return Boolean(updated);
}
