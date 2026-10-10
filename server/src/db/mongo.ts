import { MongoClient, type Db } from "mongodb";
import type { AppConfig } from "../config/env.js";

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectMongo(config: AppConfig): Promise<Db | null> {
  if (!config.mongodbUri) {
    database = null;
    return null;
  }
  if (database) return database;

  client = new MongoClient(config.mongodbUri);
  await client.connect();
  database = client.db(config.mongodbDatabase);
  console.info(
    `EchoFloor MongoDB connected (database: ${config.mongodbDatabase}).`,
  );
  return database;
}

export function getDb(): Db | null {
  return database;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}
