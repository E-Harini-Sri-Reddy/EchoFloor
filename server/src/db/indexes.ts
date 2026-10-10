import type { Db } from "mongodb";

export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("workflow_requests").createIndexes([
    { key: { requestId: 1 }, unique: true, name: "workflow_requests_requestId_unique" },
    {
      key: { status: 1, createdAt: 1 },
      name: "workflow_requests_status_createdAt",
    },
    {
      key: { createdAt: 1 },
      name: "workflow_requests_completed_ttl",
      expireAfterSeconds: 60 * 60 * 24 * 90,
      partialFilterExpression: { status: "completed" },
    },
  ]);

  await db.collection("alerts").createIndexes([
    {
      key: { eventId: 1 },
      unique: true,
      sparse: true,
      name: "alerts_eventId_unique_sparse",
    },
    {
      key: { expiresAt: 1 },
      name: "alerts_expiresAt_ttl",
      expireAfterSeconds: 0,
      partialFilterExpression: { expiresAt: { $type: "date" } },
    },
    { key: { organisationId: 1, createdAt: -1 }, name: "alerts_org_createdAt" },
  ]);

  await db.collection("constraints").createIndexes([
    {
      key: { expiresAt: 1 },
      name: "constraints_expiresAt_ttl",
      expireAfterSeconds: 0,
      partialFilterExpression: { expiresAt: { $type: "date" } },
    },
  ]);

  await db.collection("handovers").createIndexes([
    {
      key: { requestId: 1 },
      unique: true,
      sparse: true,
      name: "handovers_requestId_unique_sparse",
    },
  ]);

  await db.collection("memories").createIndexes([
    { key: { embeddingStatus: 1, updatedAt: 1 }, name: "memories_embeddingStatus_updatedAt" },
    { key: { organisationIdString: 1, machineIdString: 1 }, name: "memories_vector_filter_strings" },
  ]);
}
