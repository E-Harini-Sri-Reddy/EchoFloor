import type { Db, ObjectId } from "mongodb";
import { asObjectId, iso, mapDoc, toId } from "./ids.js";

export interface ApiSession {
  userId: string;
  organisationId: string;
  role: "admin" | "worker";
  workerAccessType: "permanent" | "temporary" | null;
  accessExpiresAt: string | null;
  displayName: string;
  email: string;
  demo: false;
  live: true;
}

function mapMachine(doc: Record<string, unknown>) {
  const mapped = mapDoc(doc);
  if (!mapped) return null;
  return {
    ...mapped,
    organisationId: toId(doc.organisationId),
    createdBy: toId(doc.createdBy),
    updatedBy: doc.updatedBy ? toId(doc.updatedBy) : undefined,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    nfc: doc.nfc ?? { tagId: null, enabled: false },
    location: doc.location ?? {},
  };
}

function mapGeneric(
  doc: Record<string, unknown>,
  idFields: string[] = ["organisationId", "userId", "machineId", "createdBy"],
) {
  const mapped = mapDoc(doc);
  if (!mapped) return null;
  const next: Record<string, unknown> = { ...mapped };
  for (const field of idFields) {
    if (doc[field] !== undefined && doc[field] !== null) {
      next[field] = toId(doc[field]);
    }
  }
  for (const key of Object.keys(next)) {
    if (next[key] instanceof Date) next[key] = iso(next[key]);
  }
  if (Array.isArray(doc.machineIds)) {
    next.machineIds = doc.machineIds.map((id) => toId(id));
  }
  if (Array.isArray(doc.memoryIds)) {
    next.memoryIds = doc.memoryIds.map((id) => toId(id));
  }
  if (Array.isArray(doc.constraintIds)) {
    next.constraintIds = doc.constraintIds.map((id) => toId(id));
  }
  if (Array.isArray(doc.targetUserIds)) {
    next.targetUserIds = doc.targetUserIds.map((id) => toId(id));
  }
  if (doc.source && typeof doc.source === "object") {
    const source = doc.source as Record<string, unknown>;
    next.source = {
      ...source,
      submittedBy: source.submittedBy ? toId(source.submittedBy) : undefined,
    };
  }
  if (doc.expiresAt) next.expiresAt = iso(doc.expiresAt);
  if (doc.accessExpiresAt) next.accessExpiresAt = iso(doc.accessExpiresAt);
  if (doc.effectiveAt) next.effectiveAt = iso(doc.effectiveAt);
  if (doc.startAt) next.startAt = iso(doc.startAt);
  if (doc.endAt) next.endAt = iso(doc.endAt);
  if (doc.joinedAt) next.joinedAt = iso(doc.joinedAt);
  if (doc.publishedAt) next.publishedAt = iso(doc.publishedAt);
  if (doc.dueAt) next.dueAt = iso(doc.dueAt);
  if (doc.createdAt) next.createdAt = iso(doc.createdAt);
  if (doc.updatedAt) next.updatedAt = iso(doc.updatedAt);
  return next;
}

export async function loadWorkspace(
  db: Db,
  organisationId: ObjectId,
  session: ApiSession,
) {
  const orgFilter = { organisationId };
  const [
    organisation,
    memberships,
    users,
    invitations,
    machines,
    memories,
    revisions,
    constraints,
    shifts,
    assignments,
    handovers,
    alerts,
    tasks,
    auditEvents,
    preferenceRows,
    credentialRows,
  ] = await Promise.all([
    db.collection("organisations").findOne({ _id: organisationId }),
    db.collection("memberships").find(orgFilter).toArray(),
    db.collection("users").find({}).toArray(),
    db.collection("invitations").find(orgFilter).toArray(),
    db.collection("machines").find(orgFilter).toArray(),
    db.collection("memories").find(orgFilter).toArray(),
    db.collection("memory_revisions").find(orgFilter).toArray(),
    db.collection("constraints").find(orgFilter).toArray(),
    db.collection("shifts").find(orgFilter).toArray(),
    db.collection("shift_assignments").find(orgFilter).toArray(),
    db.collection("handovers").find(orgFilter).toArray(),
    db.collection("alerts").find(orgFilter).toArray(),
    db.collection("tasks").find(orgFilter).toArray(),
    db.collection("audit_events").find(orgFilter).toArray(),
    db.collection("user_preferences").find(orgFilter).toArray(),
    db.collection("credentials").find({}).toArray(),
  ]);

  const memberUserIds = new Set(memberships.map((item) => toId(item.userId)));
  const orgUsers = users
    .filter((user) => memberUserIds.has(toId(user._id)))
    .map((user) => {
      const mapped = mapDoc(user);
      return mapped
        ? {
            ...mapped,
            createdAt: iso(user.createdAt),
            updatedAt: iso(user.updatedAt),
            authProviders: user.authProviders ?? ["password"],
          }
        : null;
    })
    .filter(Boolean);

  const preferences: Record<string, { emailAlerts: boolean; showVoiceTextFirst: boolean }> =
    {};
  for (const row of preferenceRows) {
    const userId = toId(row.userId);
    preferences[userId] = {
      emailAlerts: Boolean(row.emailAlerts),
      showVoiceTextFirst: Boolean(row.showVoiceTextFirst),
    };
  }

  const credentials: Record<string, { secret: string; temporary: boolean }> = {};
  for (const row of credentialRows) {
    const userId = toId(row.userId);
    if (!memberUserIds.has(userId)) continue;
    credentials[userId] = {
      // Client never verifies live passwords locally; placeholder keeps shape.
      secret: "",
      temporary: Boolean(row.temporary),
    };
  }

  const orgMapped = organisation
    ? {
        ...mapDoc(organisation),
        createdBy: toId(organisation.createdBy),
        createdAt: iso(organisation.createdAt),
        updatedAt: iso(organisation.updatedAt),
      }
    : null;

  return {
    organisations: orgMapped ? [orgMapped] : [],
    users: orgUsers,
    memberships: memberships
      .map((doc) =>
        mapGeneric(doc, [
          "organisationId",
          "userId",
        ]),
      )
      .filter(Boolean),
    invitations: invitations
      .map((doc) => mapGeneric(doc, ["organisationId", "invitedBy"]))
      .filter(Boolean),
    machines: machines.map((doc) => mapMachine(doc)).filter(Boolean),
    memories: memories
      .map((doc) =>
        mapGeneric(doc, ["organisationId", "machineId", "createdBy", "updatedBy"]),
      )
      .filter(Boolean),
    revisions: revisions
      .map((doc) =>
        mapGeneric(doc, ["organisationId", "memoryId", "changedBy"]),
      )
      .filter(Boolean),
    constraints: constraints
      .map((doc) =>
        mapGeneric(doc, ["organisationId", "machineId", "createdBy", "sourceMemoryId"]),
      )
      .filter(Boolean),
    shifts: shifts
      .map((doc) => mapGeneric(doc, ["organisationId", "createdBy"]))
      .filter(Boolean),
    assignments: assignments
      .map((doc) =>
        mapGeneric(doc, ["organisationId", "shiftId", "userId", "assignedBy"]),
      )
      .filter(Boolean),
    handovers: handovers
      .map((doc) =>
        mapGeneric(doc, [
          "organisationId",
          "createdBy",
          "fromShiftId",
          "toShiftId",
          "acknowledgedBy",
        ]),
      )
      .filter(Boolean),
    alerts: alerts
      .map((doc) =>
        mapGeneric(doc, [
          "organisationId",
          "machineId",
          "sourceId",
          "reportedBy",
          "acknowledgedBy",
        ]),
      )
      .filter(Boolean),
    tasks: tasks
      .map((doc) =>
        mapGeneric(doc, [
          "organisationId",
          "assigneeUserId",
          "assignedBy",
          "machineId",
        ]),
      )
      .filter(Boolean),
    auditEvents: auditEvents
      .map((doc) => mapGeneric(doc, ["organisationId", "actorId"]))
      .filter(Boolean),
    preferences,
    credentials,
    session,
    flags: { forceLoadError: false },
    selectedMachineId: null,
  };
}

export async function findActiveMembership(db: Db, userId: ObjectId) {
  return db.collection("memberships").findOne({
    userId,
    status: { $in: ["active", "suspended"] },
  });
}

export function sessionFromDocs(
  user: Record<string, unknown>,
  membership: Record<string, unknown>,
): ApiSession {
  const role = membership.role === "admin" ? "admin" : "worker";
  return {
    userId: toId(user._id),
    organisationId: toId(membership.organisationId),
    role,
    workerAccessType:
      role === "worker"
        ? ((membership.workerAccessType as "permanent" | "temporary") ?? "permanent")
        : null,
    accessExpiresAt:
      role === "worker" && membership.accessExpiresAt
        ? iso(membership.accessExpiresAt)
        : null,
    displayName: String(user.displayName ?? ""),
    email: String(user.email ?? ""),
    demo: false,
    live: true,
  };
}

export { asObjectId, toId };
