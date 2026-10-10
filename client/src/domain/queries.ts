import {
  isLiveOperationalAlert,
  isMachineInfoNotice,
} from "@/domain/alerts";
import type {
  Alert,
  AlertStatus,
  DemoDatabase,
  Machine,
  MemoryRecord,
  MemoryStatus,
  MemoryType,
  Severity,
  Task,
  TaskPriority,
  TaskStatus,
} from "@/types/domain";

export function organisationById(db: DemoDatabase, organisationId: string) {
  return (
    db.organisations.find((organisation) => organisation.id === organisationId) ?? null
  );
}

export function userById(db: DemoDatabase, userId: string) {
  return db.users.find((user) => user.id === userId) ?? null;
}

export function machinesFor(db: DemoDatabase, organisationId: string): Machine[] {
  return db.machines
    .filter((machine) => machine.organisationId === organisationId)
    .sort((a, b) => a.machineCode.localeCompare(b.machineCode));
}

export function machineById(db: DemoDatabase, organisationId: string, machineId: string) {
  return (
    db.machines.find(
      (machine) => machine.id === machineId && machine.organisationId === organisationId,
    ) ?? null
  );
}

export function machineByCode(
  db: DemoDatabase,
  organisationId: string,
  machineCode: string,
) {
  const code = machineCode.trim().toLowerCase();
  return (
    db.machines.find(
      (machine) =>
        machine.organisationId === organisationId &&
        machine.machineCode.toLowerCase() === code,
    ) ?? null
  );
}

export function machineByNfcTag(db: DemoDatabase, organisationId: string, tagId: string) {
  return (
    db.machines.find(
      (machine) =>
        machine.organisationId === organisationId && machine.nfc.tagId === tagId,
    ) ?? null
  );
}

export interface MemoryQuery {
  text: string;
  machineId: string | "all";
  type: MemoryType | "all";
  status: MemoryStatus | "all";
  from: string;
  to: string;
}

export function filterMemories(
  db: DemoDatabase,
  organisationId: string,
  query: MemoryQuery,
): MemoryRecord[] {
  const text = query.text.trim().toLowerCase();
  return db.memories
    .filter((memory) => memory.organisationId === organisationId)
    .filter((memory) => query.machineId === "all" || memory.machineId === query.machineId)
    .filter((memory) => query.type === "all" || memory.type === query.type)
    .filter((memory) => query.status === "all" || memory.status === query.status)
    .filter((memory) => {
      if (query.from && memory.createdAt < query.from) return false;
      if (query.to && memory.createdAt > `${query.to}T23:59:59.999Z`) return false;
      if (!text) return true;
      const machine = machineById(db, organisationId, memory.machineId);
      const haystack = [
        memory.title,
        memory.content,
        memory.summary ?? "",
        memory.tags.join(" "),
        machine?.machineCode ?? "",
        machine?.name ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function memoriesForMachine(
  db: DemoDatabase,
  organisationId: string,
  machineId: string,
): MemoryRecord[] {
  return db.memories
    .filter(
      (memory) =>
        memory.organisationId === organisationId && memory.machineId === machineId,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function memoryById(db: DemoDatabase, organisationId: string, memoryId: string) {
  return (
    db.memories.find(
      (memory) => memory.id === memoryId && memory.organisationId === organisationId,
    ) ?? null
  );
}

export function revisionsFor(db: DemoDatabase, organisationId: string, memoryId: string) {
  return db.revisions
    .filter(
      (revision) =>
        revision.organisationId === organisationId && revision.memoryId === memoryId,
    )
    .sort((a, b) => b.revisionNumber - a.revisionNumber);
}

export function constraintsForMachine(
  db: DemoDatabase,
  organisationId: string,
  machineId: string,
) {
  return db.constraints.filter(
    (constraint) =>
      constraint.organisationId === organisationId && constraint.machineId === machineId,
  );
}

export function alertsFor(
  db: DemoDatabase,
  organisationId: string,
  options?: { machineId?: string; audienceUserId?: string },
): Alert[] {
  return db.alerts
    .filter((alert) => alert.organisationId === organisationId)
    .filter((alert) => !options?.machineId || alert.machineId === options.machineId)
    .filter((alert) => {
      if (!options?.audienceUserId || !alert.targetUserIds?.length) return true;
      return alert.targetUserIds.includes(options.audienceUserId);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Operational Live Alerts only — excludes informational machine notices and expired windows. */
export function liveAlertsFor(
  db: DemoDatabase,
  organisationId: string,
  options?: { machineId?: string; audienceUserId?: string; now?: Date },
): Alert[] {
  const now = options?.now ?? new Date();
  return alertsFor(db, organisationId, options).filter((alert) =>
    isLiveOperationalAlert(alert, now),
  );
}

export function machineInfoNoticesFor(
  db: DemoDatabase,
  organisationId: string,
  machineId: string,
  now: Date = new Date(),
): Alert[] {
  return alertsFor(db, organisationId, { machineId }).filter((alert) =>
    isMachineInfoNotice(alert, now),
  );
}

export function alertById(db: DemoDatabase, organisationId: string, alertId: string) {
  return (
    db.alerts.find(
      (alert) => alert.id === alertId && alert.organisationId === organisationId,
    ) ?? null
  );
}

export interface AlertFilter {
  bucket: "all" | "critical" | "warning";
  text: string;
  machineId: string | "all";
}

export function filterAlerts(alerts: Alert[], filter: AlertFilter): Alert[] {
  const text = filter.text.trim().toLowerCase();
  return alerts.filter((alert) => {
    if (filter.machineId !== "all" && alert.machineId !== filter.machineId) return false;
    if (filter.bucket === "critical" && alert.severity !== "critical") return false;
    if (filter.bucket === "warning" && alert.severity !== "warning") return false;
    if (!text) return true;
    return `${alert.title} ${alert.message}`.toLowerCase().includes(text);
  });
}

export function countOpenAlerts(alerts: Alert[]): number {
  return alerts.filter(
    (alert) => alert.status === "open" || alert.status === "acknowledged",
  ).length;
}

export function unresolvedMemories(memories: MemoryRecord[]): MemoryRecord[] {
  return memories.filter(
    (memory) => memory.status === "unresolved" || memory.status === "pending_review",
  );
}

export function latestMemoryForMachine(memories: MemoryRecord[], machineId: string) {
  return memories
    .filter((memory) => memory.machineId === machineId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

export function memberRows(db: DemoDatabase, organisationId: string) {
  return db.memberships
    .filter(
      (membership) =>
        membership.organisationId === organisationId && membership.status !== "removed",
    )
    .map((membership) => ({
      membership,
      user: userById(db, membership.userId),
    }))
    .filter((row) => row.user !== null);
}

const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function tasksFor(
  db: DemoDatabase,
  organisationId: string,
  options?: { assigneeUserId?: string; status?: TaskStatus | "openish" },
): Task[] {
  return (db.tasks ?? [])
    .filter((task) => task.organisationId === organisationId)
    .filter((task) =>
      options?.assigneeUserId ? task.assigneeUserId === options.assigneeUserId : true,
    )
    .filter((task) => {
      if (!options?.status) return true;
      if (options.status === "openish") {
        return task.status === "open" || task.status === "in_progress";
      }
      return task.status === options.status;
    })
    .sort((a, b) => {
      const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (byPriority !== 0) return byPriority;
      return (a.dueAt ?? a.createdAt).localeCompare(b.dueAt ?? b.createdAt);
    });
}

export function activeWorkerRows(db: DemoDatabase, organisationId: string) {
  return memberRows(db, organisationId).filter(
    ({ membership }) =>
      membership.role === "worker" && membership.status === "active",
  );
}

export function assignmentsForUser(
  db: DemoDatabase,
  organisationId: string,
  userId: string,
) {
  return db.assignments.filter(
    (assignment) =>
      assignment.organisationId === organisationId &&
      assignment.userId === userId &&
      assignment.status !== "cancelled",
  );
}

export function assignmentsForShift(
  db: DemoDatabase,
  organisationId: string,
  shiftId: string,
) {
  return db.assignments.filter(
    (assignment) =>
      assignment.organisationId === organisationId &&
      assignment.shiftId === shiftId &&
      assignment.status !== "cancelled",
  );
}

export function handoversFor(db: DemoDatabase, organisationId: string) {
  return db.handovers
    .filter((handover) => handover.organisationId === organisationId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function isSeverity(value: string): value is Severity {
  return value === "info" || value === "warning" || value === "critical";
}

export function isAlertStatus(value: string): value is AlertStatus {
  return (
    value === "open" ||
    value === "acknowledged" ||
    value === "resolved" ||
    value === "dismissed"
  );
}
