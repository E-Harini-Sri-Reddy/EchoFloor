import type { Db, ObjectId } from "mongodb";
import { toId } from "../db/ids.js";

const HANDOVER_JSON_MAX = 15000;
const TEXT_SNIPPET_MAX = 400;

function truncateText(value: string, max = TEXT_SNIPPET_MAX): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function shiftWindow(shift: Record<string, unknown> | null): { start: Date; end: Date } {
  const end = shift?.endAt instanceof Date ? shift.endAt : new Date();
  const start =
    shift?.startAt instanceof Date
      ? shift.startAt
      : new Date(end.getTime() - 12 * 60 * 60 * 1000);
  return { start, end };
}

export async function buildHandoverPayload(
  db: Db,
  organisationId: ObjectId,
  shiftId: ObjectId,
): Promise<Record<string, unknown>> {
  const shift = await db.collection("shifts").findOne({
    _id: shiftId,
    organisationId,
  });
  const { start, end } = shiftWindow(shift);

  const machines = await db
    .collection("machines")
    .find({ organisationId })
    .toArray();
  const machineNameById = new Map<string, string>();
  for (const machine of machines) {
    machineNameById.set(toId(machine._id), String(machine.name ?? machine.machineCode ?? ""));
  }

  const memories = await db
    .collection("memories")
    .find({
      organisationId,
      createdAt: { $gte: start, $lte: end },
    })
    .sort({ createdAt: -1 })
    .toArray();

  const memoryRecords = memories.map((memory) => ({
    memoryId: toId(memory._id),
    machineId: toId(memory.machineId),
    machineName: machineNameById.get(toId(memory.machineId)) ?? "",
    text: truncateText(String(memory.text ?? memory.content ?? "")),
    createdAt:
      memory.createdAt instanceof Date
        ? memory.createdAt.toISOString()
        : new Date().toISOString(),
  }));

  const now = new Date();
  const constraints = await db
    .collection("constraints")
    .find({
      organisationId,
      status: "active",
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
    })
    .sort({ createdAt: -1 })
    .toArray();

  const constraintRows = constraints.map((row) => {
    const expiresAt =
      row.expiresAt instanceof Date ? row.expiresAt.toISOString() : null;
    const expired = row.expiresAt instanceof Date ? row.expiresAt <= now : false;
    return {
      machineName: machineNameById.get(toId(row.machineId)) ?? "",
      description: truncateText(String(row.description ?? row.title ?? ""), 200),
      duration: String(row.durationText ?? row.duration ?? "").trim() || null,
      expiresAt,
      expired,
      sourceMemoryId: row.sourceMemoryId ? toId(row.sourceMemoryId) : null,
    };
  });

  const unresolvedIssues = memories
    .filter((memory) => {
      const status = String(memory.status ?? "");
      return status === "unresolved" || status === "pending_review";
    })
    .map((memory) => ({
      machineName: machineNameById.get(toId(memory.machineId)) ?? "",
      description: truncateText(String(memory.title ?? memory.summary ?? memory.content ?? ""), 200),
      sourceMemoryId: toId(memory._id),
    }));

  let payload: Record<string, unknown> = {
    memoryRecords,
    unresolvedIssues,
    constraints: constraintRows,
  };

  while (JSON.stringify(payload).length > HANDOVER_JSON_MAX && memoryRecords.length > 1) {
    memoryRecords.pop();
    if (unresolvedIssues.length > memoryRecords.length) unresolvedIssues.pop();
    if (constraintRows.length > memoryRecords.length) constraintRows.pop();
    payload = { memoryRecords, unresolvedIssues, constraints: constraintRows };
  }

  if (JSON.stringify(payload).length > HANDOVER_JSON_MAX) {
    payload = {
      memoryRecords: memoryRecords.slice(0, 5),
      unresolvedIssues: unresolvedIssues.slice(0, 5),
      constraints: constraintRows.slice(0, 5),
    };
  }

  return payload;
}
