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

test("invalid PORT is rejected", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "development", PORT: "0" }), ConfigError);
});
