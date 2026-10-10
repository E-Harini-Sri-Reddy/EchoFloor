import assert from "node:assert/strict";
import test from "node:test";
import { ConfigError, integrationReport, loadConfig } from "./env.js";

test("development starts without credentials and reports integrations unavailable", () => {
  const config = loadConfig({ NODE_ENV: "development" });
  assert.equal(config.port, 5000);
  assert.equal(config.mongodbUri, null);
  assert.equal(config.authSecret, null);
  assert.equal(config.aiApiKey, null);
  const report = integrationReport(config);
  assert.equal(report.mongodb.status, "unavailable");
  assert.equal(report.googleOAuth.status, "unavailable");
  assert.equal(report.ai.status, "unavailable");
  assert.equal(report.speech.status, "unavailable");
  assert.equal(report.n8n.status, "unavailable");
});

test("production fails when required variables are missing", () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: "production", PORT: "5000" }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /MONGODB_URI/);
      assert.match(error.message, /AUTH_SECRET/);
      assert.doesNotMatch(error.message, /mongodb\+srv/);
      return true;
    },
  );
});

test("production accepts a complete non-secret configuration", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: "8080",
    CLIENT_URL: "https://app.example.com",
    MONGODB_URI: "mongodb+srv://user:secret@cluster.example.net/echofloor",
    MONGODB_DATABASE: "echofloor",
    AUTH_SECRET: "test-secret-value",
  });
  assert.equal(config.port, 8080);
  assert.equal(integrationReport(config).mongodb.status, "configured");
});

test("production uses RENDER_EXTERNAL_URL when CLIENT_URL is omitted", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: "10000",
    RENDER_EXTERNAL_URL: "https://echofloor.onrender.com",
    MONGODB_URI: "mongodb+srv://user:secret@cluster.example.net/echofloor",
    MONGODB_DATABASE: "echofloor",
    AUTH_SECRET: "test-secret-value",
  });
  assert.equal(config.clientUrl, "https://echofloor.onrender.com");
  assert.equal(config.serverUrl, "https://echofloor.onrender.com");
});

test("invalid PORT is rejected", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "development", PORT: "0" }), ConfigError);
});

test("n8n integration reports configured with webhook key, callback secret, and voice URL", () => {
  const config = loadConfig({
    NODE_ENV: "development",
    N8N_WEBHOOK_KEY: "outbound-key",
    N8N_CALLBACK_SECRET: "callback-secret",
    N8N_VOICE_QUESTION_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-voice-question",
    EMBEDDING_DIMENSIONS: "1024",
    EMBEDDING_BACKFILL_DELAY_MS: "2500",
    N8N_REQUEST_TIMEOUT_MS: "90000",
  });
  assert.equal(config.embeddingDimensions, 1024);
  assert.equal(config.embeddingBackfillDelayMs, 2500);
  assert.equal(config.n8nRequestTimeoutMs, 90000);
  assert.equal(config.atlasVectorIndexName, "echofloor_records_vector_index");
  assert.equal(integrationReport(config).n8n.status, "configured");
});

test("legacy N8N_WEBHOOK_SECRET maps to callback and webhook key", () => {
  const config = loadConfig({
    NODE_ENV: "development",
    N8N_WEBHOOK_SECRET: "legacy-shared-secret",
    N8N_BASE_URL: "https://n8n.example",
    N8N_VOICE_QUESTION_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-voice-question",
  });
  assert.equal(config.n8nWebhookKey, "legacy-shared-secret");
  assert.equal(config.n8nCallbackSecret, "legacy-shared-secret");
  assert.equal(integrationReport(config).n8n.status, "configured");
});
