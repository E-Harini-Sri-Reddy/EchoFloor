import type { AppConfig } from "../config/env.js";

export class EmbeddingClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingClientError";
  }
}

function resolveEmbeddingAuth(config: AppConfig): {
  provider: string;
  apiKey: string;
  model: string;
} | null {
  const provider = (
    config.embeddingProvider ??
    (config.embeddingApiKey || process.env.VOYAGE_API_KEY ? "voyage" : null) ??
    config.aiProvider ??
    ""
  )
    .trim()
    .toLowerCase();
  const apiKey =
    config.embeddingApiKey?.trim() ||
    process.env.VOYAGE_API_KEY?.trim() ||
    config.aiApiKey?.trim() ||
    "";
  const model =
    config.embeddingModel?.trim() ||
    (provider.startsWith("voyage") ? "voyage-3-lite" : "") ||
    "";
  if (!provider || !apiKey || !model) return null;
  return { provider, apiKey, model };
}

/**
 * Embed a query string for Atlas Vector Search. Returns null when embeddings are not configured.
 */
export async function embedQueryText(
  config: AppConfig,
  text: string,
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
        input_type: "query",
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

  // OpenAI-compatible embeddings (openai, groq embeddings hosts, etc.)
  const base =
    auth.provider === "groq"
      ? "https://api.groq.com/openai/v1/embeddings"
      : "https://api.openai.com/v1/embeddings";
  const response = await fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    },
    body: JSON.stringify({
      input,
      model: auth.model,
      dimensions: config.embeddingDimensions,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new EmbeddingClientError(
      `Embedding API failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }
  const body = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const vector = body.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new EmbeddingClientError("Embedding response was empty.");
  }
  return vector;
}
