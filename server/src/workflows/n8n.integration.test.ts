import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ObjectId } from "mongodb";
import { createApp } from "../app.js";
import { loadConfig } from "../config/env.js";
import { closeMongo } from "../db/mongo.js";
import { buildHandoverPayload } from "../services/handoverData.js";

const CALLBACK_SECRET = "test-callback-secret-value";
const WEBHOOK_KEY = "test-webhook-key-value";

let memoryServer: MongoMemoryServer | null = null;

async function startTestApp() {
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri();
  const config = loadConfig({
    NODE_ENV: "test",
    CLIENT_URL: "http://localhost:5173",
    MONGODB_URI: uri,
    MONGODB_DATABASE: "echofloor_test",
    N8N_WEBHOOK_KEY: WEBHOOK_KEY,
    N8N_CALLBACK_SECRET: CALLBACK_SECRET,
    N8N_VOICE_QUESTION_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-voice-question",
    N8N_WORKER_REPORT_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-worker-report",
    N8N_SHIFT_HANDOVER_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-shift-handover",
    N8N_MEMORY_EMBEDDING_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-memory-embedding",
    N8N_ALERT_WEBHOOK_URL: "https://n8n.example/webhook/echofloor-alert-processing",
    EMBEDDING_DIMENSIONS: "1024",
  });
  const app = await createApp(config);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${address.port}/api/v1/workflows`;
  return { app, server, base, config, uri };
}

async function stopTestApp(server: import("node:http").Server) {
  server.close();
  await once(server, "close");
  await closeMongo();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

function secretHeaders() {
  return {
    "Content-Type": "application/json",
    N8N_CALLBACK_SECRET: CALLBACK_SECRET,
  };
}

test("callback auth rejects missing and wrong secret", async () => {
  const { server, base } = await startTestApp();
  try {
    const missing = await fetch(`${base}/callbacks/alerts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${base}/callbacks/alerts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        N8N_CALLBACK_SECRET: "wrong-secret-value-here",
      },
      body: JSON.stringify({}),
    });
    assert.equal(wrong.status, 401);
  } finally {
    await stopTestApp(server);
  }
});

test("voice-answers callback is idempotent and filters recordIds by tenant", async () => {
  const { server, base, uri, config } = await startTestApp();
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("echofloor_test");

  const orgA = new ObjectId();
  const orgB = new ObjectId();
  const machineA = new ObjectId();
  const memoryA = new ObjectId();
  const memoryB = new ObjectId();
  const requestId = crypto.randomUUID();

  await db.collection("workflow_requests").insertOne({
    _id: new ObjectId(),
    requestId,
    type: "voice_question",
    organisationId: orgA,
    machineId: machineA,
    userId: new ObjectId(),
    status: "pending",
    createdAt: new Date(),
  });
  await db.collection("memories").insertMany([
    {
      _id: memoryA,
      organisationId: orgA,
      machineId: machineA,
      content: "Allowed memory",
      createdAt: new Date(),
    },
    {
      _id: memoryB,
      organisationId: orgB,
      machineId: new ObjectId(),
      content: "Other org",
      createdAt: new Date(),
    },
  ]);

  try {
    const body = {
      requestId,
      answer: "Test answer",
      recordIds: [memoryA.toHexString(), memoryB.toHexString()],
    };
    const first = await fetch(`${base}/callbacks/voice-answers`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(first.status, 200);
    const firstJson = (await first.json()) as { ok: boolean };
    assert.equal(firstJson.ok, true);

    const second = await fetch(`${base}/callbacks/voice-answers`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify(body),
    });
    assert.equal(second.status, 200);

    const wf = await db.collection("workflow_requests").findOne({ requestId });
    assert.equal(wf?.status, "completed");
    const result = wf?.result as { evidenceRecordIds: string[] };
    assert.deepEqual(result.evidenceRecordIds, [memoryA.toHexString()]);
    void config;
  } finally {
    await client.close();
    await stopTestApp(server);
  }
});

test("embeddings callback ignores stale contentVersion", async () => {
  const { server, base, uri } = await startTestApp();
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("echofloor_test");
  const orgId = new ObjectId();
  const memoryId = new ObjectId();
  await db.collection("memories").insertOne({
    _id: memoryId,
    organisationId: orgId,
    contentVersion: 2,
    embeddingStatus: "pending",
    text: "hello",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const vector = Array.from({ length: 1024 }, () => 0.01);
    const response = await fetch(`${base}/callbacks/embeddings`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify({
        memoryId: memoryId.toHexString(),
        organisationId: orgId.toHexString(),
        contentVersion: 1,
        vector,
      }),
    });
    const json = (await response.json()) as { ok: boolean; stale?: boolean };
    assert.equal(response.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.stale, true);
    const memory = await db.collection("memories").findOne({ _id: memoryId });
    assert.notEqual(memory?.embeddingStatus, "ready");
  } finally {
    await client.close();
    await stopTestApp(server);
  }
});

test("alerts callback dedupes by eventId", async () => {
  const { server, base, uri } = await startTestApp();
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("echofloor_test");
  const orgId = new ObjectId();
  const eventId = "dedupe-test-event-id-001";

  try {
    const payload = {
      eventId,
      organisationId: orgId.toHexString(),
      severity: "info",
      title: "Title",
      message: "Message body",
    };
    const first = await fetch(`${base}/callbacks/alerts`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify(payload),
    });
    assert.equal(first.status, 200);
    const second = await fetch(`${base}/callbacks/alerts`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify(payload),
    });
    assert.equal(second.status, 200);
    const count = await db.collection("alerts").countDocuments({ eventId });
    assert.equal(count, 1);
  } finally {
    await client.close();
    await stopTestApp(server);
  }
});

test("handover-data rejects mismatched shiftId and organisationId", async () => {
  const { server, base, uri } = await startTestApp();
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("echofloor_test");
  const orgId = new ObjectId();
  const shiftId = new ObjectId();
  const requestId = crypto.randomUUID();

  await db.collection("workflow_requests").insertOne({
    _id: new ObjectId(),
    requestId,
    type: "shift_handover",
    organisationId: orgId,
    shiftId,
    userId: new ObjectId(),
    status: "pending",
    createdAt: new Date(),
  });

  try {
    const response = await fetch(`${base}/internal/handover-data`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify({
        requestId,
        shiftId: new ObjectId().toHexString(),
        organisationId: orgId.toHexString(),
      }),
    });
    assert.equal(response.status, 403);
  } finally {
    await client.close();
    await stopTestApp(server);
  }
});

test("handover payload stays under size cap", async () => {
  const { server, uri } = await startTestApp();
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("echofloor_test");
  const orgId = new ObjectId();
  const shiftId = new ObjectId();
  const machineId = new ObjectId();
  await db.collection("machines").insertOne({
    _id: machineId,
    organisationId: orgId,
    name: "Press 1",
    machineCode: "P1",
  });
  const now = Date.now();
  const docs = Array.from({ length: 80 }, (_, index) => ({
    _id: new ObjectId(),
    organisationId: orgId,
    machineId,
    text: `Record ${index} `.padEnd(500, "x"),
    content: `Record ${index}`,
    status: index % 2 === 0 ? "unresolved" : "resolved",
    title: `Issue ${index}`,
    createdAt: new Date(now - index * 60_000),
  }));
  await db.collection("memories").insertMany(docs);
  await db.collection("shifts").insertOne({
    _id: shiftId,
    organisationId: orgId,
    startAt: new Date(now - 12 * 60 * 60 * 1000),
    endAt: new Date(now),
  });

  try {
    const payload = await buildHandoverPayload(db, orgId, shiftId);
    assert.ok(JSON.stringify(payload).length <= 15000);
  } finally {
    await client.close();
    await stopTestApp(server);
  }
});

test("validation errors return 400 for malformed callbacks", async () => {
  const { server, base } = await startTestApp();
  try {
    const response = await fetch(`${base}/callbacks/alerts`, {
      method: "POST",
      headers: secretHeaders(),
      body: JSON.stringify({
        eventId: "evt-1",
        organisationId: new ObjectId().toHexString(),
        severity: "urgent",
        title: "",
        message: "",
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    await stopTestApp(server);
  }
});
