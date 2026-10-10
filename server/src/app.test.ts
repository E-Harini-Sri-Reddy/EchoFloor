import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";

test("health reports missing integrations without throwing", async () => {
  const config = loadConfig({ NODE_ENV: "test", CLIENT_URL: "http://localhost:5173" });
  const app = createApp(config);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/health`);
    const body = (await response.json()) as {
      success: boolean;
      data: {
        dataApi: string;
        integrations: {
          mongodb: { status: string };
          googleOAuth: { status: string };
          ai: { status: string };
        };
      };
    };
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.dataApi, "not_implemented");
    assert.equal(body.data.integrations.mongodb.status, "unavailable");
    assert.equal(body.data.integrations.googleOAuth.status, "unavailable");
    assert.equal(body.data.integrations.ai.status, "unavailable");
    assert.equal(JSON.stringify(body).includes("mongodb+srv"), false);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("google auth reports unavailable when client id is missing", async () => {
  const config = loadConfig({ NODE_ENV: "test", CLIENT_URL: "http://localhost:5173" });
  const app = createApp(config);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: "not-a-real-token" }),
    });
    const body = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };
    assert.equal(response.status, 503);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "UNAVAILABLE");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("unknown routes return a consistent error", async () => {
  const config = loadConfig({ NODE_ENV: "test", CLIENT_URL: "http://localhost:5173" });
  const app = createApp(config);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/memories`);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    assert.equal(response.status, 404);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NOT_FOUND");
  } finally {
    server.close();
    await once(server, "close");
  }
});
