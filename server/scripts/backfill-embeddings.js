/**
 * Embed ALL searchable workspace data into the unified `records` collection
 * (alerts, memories, constraints, tasks, machines, handovers).
 *
 * Usage:
 *   node server/scripts/backfill-embeddings.js
 *
 * Requires MONGODB_URI and EMBEDDING_ / VOYAGE_API_KEY (preferred).
 * Avoids "*/" inside this comment block.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDir, "../../.env") });

const delayMs = Number(process.env.EMBEDDING_BACKFILL_DELAY_MS ?? 2500);
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);

const SOURCES = [
  { sourceType: "memory", collection: "memories" },
  { sourceType: "alert", collection: "alerts" },
  { sourceType: "constraint", collection: "constraints" },
  { sourceType: "task", collection: "tasks" },
  { sourceType: "machine", collection: "machines" },
  { sourceType: "handover", collection: "handovers" },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clean(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveAuth() {
  const voyageKey = process.env.VOYAGE_API_KEY?.trim() || "";
  const apiKey =
    process.env.EMBEDDING_API_KEY?.trim() ||
    voyageKey ||
    process.env.AI_API_KEY?.trim() ||
    "";
  if (!apiKey) return null;
  let provider = (process.env.EMBEDDING_PROVIDER || "").trim().toLowerCase();
  if (!provider) provider = voyageKey ? "voyage" : "openai";
  let model = (process.env.EMBEDDING_MODEL || "").trim();
  if (!model) {
    model = provider.startsWith("voyage") ? "voyage-3-lite" : "text-embedding-3-small";
  }
  return { provider, apiKey, model };
}

async function embedDirect(auth, text) {
  if (auth.provider.startsWith("voyage")) {
    const response = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify({
        input: [text],
        model: auth.model,
        input_type: "document",
      }),
    });
    if (!response.ok) {
      throw new Error(`Voyage HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }
    const body = await response.json();
    return body.data?.[0]?.embedding;
  }

  const payload = { input: text, model: auth.model };
  if (String(auth.model).startsWith("text-embedding-3")) {
    payload.dimensions = dimensions;
  }
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`OpenAI HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const body = await response.json();
  return body.data?.[0]?.embedding;
}

function buildText(sourceType, doc) {
  switch (sourceType) {
    case "memory":
      return (
        clean(doc.text) ||
        [clean(doc.title), clean(doc.summary), clean(doc.content)].filter(Boolean).join(". ")
      );
    case "alert":
      return [
        `Alert: ${clean(doc.title)}`,
        clean(doc.issueKind) ? `Issue kind: ${clean(doc.issueKind)}` : "",
        clean(doc.message),
        clean(doc.status) ? `Status: ${clean(doc.status)}` : "",
        clean(doc.severity) ? `Severity: ${clean(doc.severity)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    case "constraint":
      return [
        `Constraint: ${clean(doc.title) || clean(doc.description)}`,
        clean(doc.description),
        clean(doc.status) ? `Status: ${clean(doc.status)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    case "task":
      return [
        `Task: ${clean(doc.title)}`,
        clean(doc.description),
        clean(doc.status) ? `Status: ${clean(doc.status)}` : "",
        clean(doc.priority) ? `Priority: ${clean(doc.priority)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    case "machine":
      return [
        `Machine: ${clean(doc.machineCode)} — ${clean(doc.name)}`,
        clean(doc.description),
        clean(doc.machineType) ? `Type: ${clean(doc.machineType)}` : "",
        clean(doc.status) ? `Status: ${clean(doc.status)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    case "handover":
      return [
        `Handover: ${clean(doc.title)}`,
        clean(doc.summary),
        clean(doc.status) ? `Status: ${clean(doc.status)}` : "",
      ]
        .filter(Boolean)
        .join(". ");
    default:
      return "";
  }
}

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  const database = process.env.MONGODB_DATABASE?.trim() || "echofloor";
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  const auth = resolveAuth();
  if (!auth) {
    console.error("Set EMBEDDING_API_KEY or VOYAGE_API_KEY in .env");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(database);

  let embedded = 0;
  let skipped = 0;
  let already = 0;

  for (const { sourceType, collection } of SOURCES) {
    console.info(`Scanning ${collection} → records (${sourceType})…`);
    const cursor = db.collection(collection).find({});
    for await (const doc of cursor) {
      if (!doc.organisationId && sourceType !== "machine") {
        skipped += 1;
        continue;
      }
      const organisationId = doc.organisationId;
      if (!organisationId) {
        skipped += 1;
        continue;
      }

      const existing = await db.collection("records").findOne({
        sourceType,
        sourceId: doc._id,
        organisationId,
        embeddingStatus: "ready",
        embedding: { $exists: true, $ne: null },
      });
      if (existing) {
        already += 1;
        continue;
      }

      const text = buildText(sourceType, doc);
      if (!text) {
        skipped += 1;
        continue;
      }

      const machineId =
        sourceType === "machine" ? doc._id : doc.machineId || undefined;
      const organisationIdString = String(organisationId);
      const machineIdString = machineId ? String(machineId) : undefined;
      const title =
        clean(doc.title) ||
        clean(doc.machineCode) ||
        clean(doc.name) ||
        sourceType;

      try {
        const vector = await embedDirect(auth, text.slice(0, 8000));
        if (!Array.isArray(vector) || vector.length === 0) {
          throw new Error("Empty embedding vector.");
        }

        await db.collection("records").updateOne(
          { sourceType, sourceId: doc._id, organisationId },
          {
            $set: {
              sourceType,
              sourceId: doc._id,
              organisationId,
              ...(machineId ? { machineId } : {}),
              organisationIdString,
              ...(machineIdString ? { machineIdString } : {}),
              title,
              text,
              content: text,
              summary: text.slice(0, 200),
              status: clean(doc.status) || undefined,
              type: clean(doc.type) || sourceType,
              tags: [sourceType],
              embedding: vector,
              embeddingStatus: "ready",
              embeddedAt: new Date(),
              contentVersion: Number(doc.contentVersion ?? 1),
              updatedAt: new Date(),
            },
            $setOnInsert: { createdAt: doc.createdAt instanceof Date ? doc.createdAt : new Date() },
            $unset: { embeddingAttempts: "" },
          },
          { upsert: true },
        );

        if (sourceType === "memory") {
          await db.collection("memories").updateOne(
            { _id: doc._id },
            {
              $set: {
                embedding: vector,
                embeddingStatus: "ready",
                embeddedAt: new Date(),
                organisationIdString,
                ...(machineIdString ? { machineIdString } : {}),
                updatedAt: new Date(),
              },
            },
          );
        }

        embedded += 1;
        console.info(`Embedded ${sourceType} ${doc._id} (dims=${vector.length}).`);
      } catch (error) {
        console.error(
          `Failed ${sourceType} ${doc._id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
        skipped += 1;
        // Voyage free tier: stop hammering on 429
        if (String(error).includes("429")) {
          console.error("Rate limited — wait a minute and re-run this script.");
          await client.close();
          console.info(
            `Partial complete. embedded=${embedded} alreadyReady=${already} skipped=${skipped}`,
          );
          process.exit(0);
        }
      }

      await sleep(delayMs);
    }
  }

  console.info(
    `Backfill complete. embedded=${embedded} alreadyReady=${already} skipped=${skipped} targetDims=${dimensions}`,
  );
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
