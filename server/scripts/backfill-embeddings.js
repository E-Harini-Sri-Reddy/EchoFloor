/**
 * Resumable embedding backfill: sends memories without ready embeddings to n8n workflow C.
 * Usage (from server/): node scripts/backfill-embeddings.js
 * Requires MONGODB_URI and n8n env vars in ../../.env
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(serverDir, "../../.env") });

const delayMs = Number(process.env.EMBEDDING_BACKFILL_DELAY_MS ?? 2500);
const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);
const webhookUrl = process.env.N8N_MEMORY_EMBEDDING_WEBHOOK_URL?.trim();
const webhookKey = process.env.N8N_WEBHOOK_KEY?.trim() ?? process.env.N8N_WEBHOOK_SECRET?.trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const uri = process.env.MONGODB_URI?.trim();
  const database = process.env.MONGODB_DATABASE?.trim() || "echofloor";
  if (!uri) {
    console.error("MONGODB_URI is required.");
    process.exit(1);
  }
  if (!webhookUrl || !webhookKey) {
    console.error("N8N_MEMORY_EMBEDDING_WEBHOOK_URL and N8N_WEBHOOK_KEY are required.");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(database);

  const cursor = db.collection("memories").find({
    $or: [{ embeddingStatus: { $exists: false } }, { embeddingStatus: { $ne: "ready" } }],
  });

  let sent = 0;
  let skipped = 0;
  for await (const memory of cursor) {
    const text = String(memory.text ?? memory.content ?? "").trim();
    if (!text) {
      skipped += 1;
      continue;
    }
    const memoryId = String(memory._id);
    const organisationId = String(memory.organisationId);
    const contentVersion = Number(memory.contentVersion ?? 1);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EchoFloor-Key": webhookKey,
      },
      body: JSON.stringify({
        memoryId,
        organisationId,
        contentVersion,
        content: text.slice(0, 30000),
      }),
    });
    if (!response.ok) {
      console.error(`Failed for memory ${memoryId} (HTTP ${response.status}).`);
      skipped += 1;
    } else {
      sent += 1;
      await db.collection("memories").updateOne(
        { _id: memory._id },
        {
          $set: {
            embeddingStatus: "pending",
            contentVersion,
            updatedAt: new Date(),
          },
        },
      );
    }
    await sleep(delayMs);
  }

  console.info(
    `Backfill complete. sent=${sent} skipped=${skipped} dimensions=${dimensions}`,
  );
  await client.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
