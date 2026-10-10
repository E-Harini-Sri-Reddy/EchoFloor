import { ObjectId, type Db } from "mongodb";
import { toId } from "../db/ids.js";

export type WorkflowRequestType =
  | "voice_question"
  | "worker_report"
  | "shift_handover";

export type WorkflowRequestStatus = "pending" | "completed" | "failed";

export interface WorkflowRequestDoc {
  _id: ObjectId;
  requestId: string;
  type: WorkflowRequestType;
  organisationId: ObjectId;
  machineId?: ObjectId;
  shiftId?: ObjectId;
  userId: ObjectId;
  status: WorkflowRequestStatus;
  result?: unknown;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}

export async function createWorkflowRequest(
  db: Db,
  input: {
    requestId: string;
    type: WorkflowRequestType;
    organisationId: ObjectId;
    userId: ObjectId;
    machineId?: ObjectId;
    shiftId?: ObjectId;
  },
): Promise<WorkflowRequestDoc> {
  const now = new Date();
  const doc: WorkflowRequestDoc = {
    _id: new ObjectId(),
    requestId: input.requestId,
    type: input.type,
    organisationId: input.organisationId,
    userId: input.userId,
    machineId: input.machineId,
    shiftId: input.shiftId,
    status: "pending",
    createdAt: now,
  };
  await db.collection("workflow_requests").insertOne(doc);
  return doc;
}

export async function findWorkflowRequest(db: Db, requestId: string) {
  return db.collection("workflow_requests").findOne({ requestId });
}

export async function completeWorkflowRequest(
  db: Db,
  requestId: string,
  result: unknown,
): Promise<{ updated: boolean; doc: Record<string, unknown> | null }> {
  const updated = await db.collection("workflow_requests").findOneAndUpdate(
    { requestId, status: "pending" },
    {
      $set: {
        status: "completed",
        result,
        completedAt: new Date(),
      },
    },
    { returnDocument: "after" },
  );
  return { updated: Boolean(updated), doc: updated };
}

export async function failWorkflowRequest(
  db: Db,
  requestId: string,
  errorMessage: string,
): Promise<void> {
  await db.collection("workflow_requests").updateOne(
    { requestId, status: "pending" },
    {
      $set: {
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      },
    },
  );
}

export function workflowRequestOrgId(doc: Record<string, unknown>): string {
  return toId(doc.organisationId);
}

export function workflowRequestMachineId(doc: Record<string, unknown>): string | null {
  return doc.machineId ? toId(doc.machineId) : null;
}
