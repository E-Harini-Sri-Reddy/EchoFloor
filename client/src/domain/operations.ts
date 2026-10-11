import {
  loginBlockedMessage,
  membershipAccessState,
  membershipAllowsLogin,
  resolveAccessExpiry,
  workerAccessTypeOf,
} from "@/domain/access";
import {
  authProvidersOf,
  hasPasswordCredential,
  setCredential,
  verifyPassword,
  withAuthProvider,
} from "@/domain/credentials";
import { applyDraft } from "@/domain/memoryEdits";
import { isConstraintActive } from "@/domain/constraints";
import {
  machineByCode,
  machineById,
  memoriesForMachine,
  memoryById,
} from "@/domain/queries";
import {
  MAX_ISSUE_PHOTO_BYTES,
  alertTypeForIssue,
  labelMachineIssueKind,
  severityForIssue,
} from "@/domain/alerts";
import { sessionFromMembership } from "@/domain/session";
import {
  DEFAULT_SHIFT_POLICY,
  ensureShiftKind,
  restWindowViolation,
  shiftPolicyOf,
  templatesChanged,
  timingChangeAllowed,
} from "@/domain/shifts";
import type {
  Alert,
  DemoDatabase,
  EditableMemory,
  FieldChange,
  Machine,
  MachineIssueKind,
  Membership,
  MembershipRole,
  MemoryRecord,
  MemorySourceType,
  MemoryType,
  OrganisationShiftPolicy,
  Session,
  ShiftKind,
  ShiftRotation,
  ShiftTemplate,
  Task,
  TaskPriority,
  TaskStatus,
  WorkerAccessDuration,
  WorkerAccessType,
} from "@/types/domain";
import { isEmail, newId, normalizeEmail, slugify } from "@/utils/format";

export interface OperationFailure {
  ok: false;
  code: "FORBIDDEN" | "VALIDATION" | "CONFLICT" | "NOT_FOUND";
  message: string;
  fieldErrors?: Record<string, string>;
}

export interface OperationSuccess<T = undefined> {
  ok: true;
  db: DemoDatabase;
  data?: T;
}

export type OperationResult<T = undefined> = OperationSuccess<T> | OperationFailure;

function fail(
  code: OperationFailure["code"],
  message: string,
  fieldErrors?: Record<string, string>,
): OperationFailure {
  return { ok: false, code, message, fieldErrors };
}

function audit(
  session: Session,
  action: string,
  targetType: string,
  targetId: string,
  summary: string,
) {
  return {
    id: newId("audit"),
    organisationId: session.organisationId,
    actorId: session.userId,
    action,
    targetType,
    targetId,
    summary,
    createdAt: new Date().toISOString(),
  };
}

function requireAdmin(db: DemoDatabase): Session | OperationFailure {
  if (!db.session) {
    return fail("FORBIDDEN", "Sign in is required.");
  }
  if (db.session.role !== "admin") {
    return fail("FORBIDDEN", "Only an administrator can do that.");
  }
  return db.session;
}

function isSession(value: Session | OperationFailure): value is Session {
  return !("ok" in value);
}

export function registerOrganisation(
  db: DemoDatabase,
  input: {
    organisationName: string;
    displayName: string;
    email: string;
    password: string;
  },
): OperationResult<{ session: Session }> {
  const fieldErrors: Record<string, string> = {};
  if (input.organisationName.trim().length < 2) {
    fieldErrors.organisationName = "Enter the organisation name.";
  }
  if (input.displayName.trim().length < 2) {
    fieldErrors.displayName = "Enter your name.";
  }
  if (!isEmail(input.email)) {
    fieldErrors.email = "Enter a valid email address.";
  }
  if (input.password.length < 8) {
    fieldErrors.password = "Use at least 8 characters.";
  }
  const email = normalizeEmail(input.email);
  const slug = slugify(input.organisationName);
  if (!slug) {
    fieldErrors.organisationName =
      "Use a name that can become an organisation identifier.";
  }
  if (db.users.some((user) => user.emailNormalized === email)) {
    fieldErrors.email = "That email is already used in this browser session.";
  }
  if (slug && db.organisations.some((organisation) => organisation.slug === slug)) {
    fieldErrors.organisationName =
      "An organisation with that identifier already exists in this session.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the highlighted fields.", fieldErrors);
  }

  const now = new Date().toISOString();
  const userId = newId("user");
  const organisationId = newId("org");
  const session: Session = {
    userId,
    organisationId,
    role: "admin",
    workerAccessType: null,
    accessExpiresAt: null,
    displayName: input.displayName.trim(),
    email,
    demo: true,
    live: false,
  };

  const nextDb = setCredential(
    {
      ...db,
      users: [
        ...db.users,
        {
          id: userId,
          email,
          emailNormalized: email,
          displayName: input.displayName.trim(),
          authProviders: ["password"],
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      organisations: [
        ...db.organisations,
        {
          id: organisationId,
          name: input.organisationName.trim(),
          slug,
          status: "active",
          settings: {
            timezone: "Asia/Kolkata",
            defaultShiftDurationMinutes: 480,
            shiftPolicy: { ...DEFAULT_SHIFT_POLICY, lastTimingChangedAt: null },
          },
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        },
      ],
      memberships: [
        ...db.memberships,
        {
          id: newId("memship"),
          organisationId,
          userId,
          role: "admin",
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
      preferences: {
        ...db.preferences,
        [userId]: { emailAlerts: true, showVoiceTextFirst: false },
      },
      session,
      selectedMachineId: null,
    },
    userId,
    input.password,
    false,
  );

  return {
    ok: true,
    data: { session },
    db: nextDb,
  };
}

function establishSession(
  db: DemoDatabase,
  userId: string,
): OperationResult<{ session: Session }> {
  const user = db.users.find((candidate) => candidate.id === userId);
  if (!user || user.status !== "active") {
    return fail("VALIDATION", "Email or password is incorrect.");
  }
  const membership = preferredMembership(db, user.id);
  if (!membership) {
    return fail("VALIDATION", "Email or password is incorrect.");
  }
  const accessState = membershipAccessState(membership);
  if (!membershipAllowsLogin(membership)) {
    return fail(
      "FORBIDDEN",
      loginBlockedMessage(accessState) ?? "This membership cannot sign in.",
    );
  }
  const organisation = db.organisations.find(
    (item) => item.id === membership.organisationId,
  );
  if (!organisation || organisation.status !== "active") {
    return fail("FORBIDDEN", "That organisation is not available.");
  }
  const session = sessionFromMembership(user, membership);
  return { ok: true, data: { session }, db: { ...db, session, selectedMachineId: null } };
}

/** Preview helper: enter without checking credentials. */
export function loginAsEmail(
  db: DemoDatabase,
  email: string,
): OperationResult<{ session: Session }> {
  const normalized = normalizeEmail(email);
  const user = db.users.find((candidate) => candidate.emailNormalized === normalized);
  if (!user) {
    return fail("VALIDATION", "Email or password is incorrect.");
  }
  return establishSession(db, user.id);
}

const NO_ACCOUNT_SIGN_IN_MESSAGE =
  "No EchoFloor account was found for this email. If you represent an organisation, use Register to create one. If you are a worker, contact your organisation administrator for sign-in access.";

export function loginWithPassword(
  db: DemoDatabase,
  email: string,
  password: string,
): OperationResult<{ session: Session }> {
  const normalized = normalizeEmail(email);
  const user = db.users.find((candidate) => candidate.emailNormalized === normalized);
  if (!user) {
    return fail("NOT_FOUND", NO_ACCOUNT_SIGN_IN_MESSAGE, {
      email: NO_ACCOUNT_SIGN_IN_MESSAGE,
    });
  }
  if (user.status !== "active") {
    return fail("FORBIDDEN", "This account is disabled.", {
      email: "This account is disabled. Contact your organisation administrator.",
    });
  }

  // Google-only accounts have no local credential (e.g. organisation signup via Google).
  if (!hasPasswordCredential(db, user.id)) {
    if (authProvidersOf(user).includes("google")) {
      return fail(
        "VALIDATION",
        "This account was registered with Google. Please sign in with Google to continue.",
        {
          email:
            "This account was registered with Google. Please use Sign in with Google instead of email and password.",
        },
      );
    }
    return fail("VALIDATION", "Email or password is incorrect.", {
      password: "Email or password is incorrect.",
    });
  }

  if (!verifyPassword(db, user.id, password)) {
    return fail("VALIDATION", "Email or password is incorrect.", {
      password: "Email or password is incorrect.",
    });
  }

  const linked = {
    ...db,
    users: db.users.map((candidate) =>
      candidate.id === user.id ? withAuthProvider(candidate, "password") : candidate,
    ),
  };
  return establishSession(linked, user.id);
}

/**
 * Mock Google OAuth: resolve by email to the same user id as password sign-in.
 * Links the Google provider when the account already exists (same email).
 */
export function loginWithGoogle(
  db: DemoDatabase,
  email: string,
): OperationResult<{ session: Session }> {
  const normalized = normalizeEmail(email);
  if (!isEmail(normalized)) {
    return fail("VALIDATION", "Enter the Google account email.", {
      email: "Enter a valid email address.",
    });
  }
  const user = db.users.find((candidate) => candidate.emailNormalized === normalized);
  if (!user) {
    return fail("NOT_FOUND", NO_ACCOUNT_SIGN_IN_MESSAGE, {
      email: NO_ACCOUNT_SIGN_IN_MESSAGE,
    });
  }
  if (user.status !== "active") {
    return fail("FORBIDDEN", "This account is disabled.", {
      email: "This account is disabled. Contact your organisation administrator.",
    });
  }
  const linked = {
    ...db,
    users: db.users.map((candidate) =>
      candidate.id === user.id ? withAuthProvider(candidate, "google") : candidate,
    ),
  };
  return establishSession(linked, user.id);
}

/** Register a new organisation using a mock Google account (same user id forever after). */
export function registerOrganisationWithGoogle(
  db: DemoDatabase,
  input: {
    organisationName: string;
    displayName: string;
    email: string;
  },
): OperationResult<{ session: Session }> {
  const created = registerOrganisation(db, {
    ...input,
    // Satisfies the shared validator; credential is removed below.
    password: "google-oauth-placeholder",
  });
  if (!created.ok) return created;
  const userId = created.data?.session.userId;
  if (!userId) return fail("VALIDATION", "Could not create the organisation.");
  const { [userId]: _removed, ...restCredentials } = created.db.credentials ?? {};
  void _removed;
  const users = created.db.users.map((user) =>
    user.id === userId
      ? {
          ...user,
          authProviders: ["google" as const],
          updatedAt: new Date().toISOString(),
        }
      : user,
  );
  return {
    ok: true,
    data: created.data,
    db: { ...created.db, users, credentials: restCredentials },
  };
}

function preferredMembership(db: DemoDatabase, userId: string): Membership | undefined {
  return db.memberships.find(
    (item) =>
      item.userId === userId &&
      (item.status === "active" || item.status === "suspended"),
  );
}

export function logout(db: DemoDatabase): DemoDatabase {
  return { ...db, session: null, selectedMachineId: null };
}

export function setForceLoadError(
  db: DemoDatabase,
  forceLoadError: boolean,
): DemoDatabase {
  return { ...db, flags: { ...db.flags, forceLoadError } };
}

export function selectMachine(
  db: DemoDatabase,
  machineId: string | null,
): OperationResult {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  if (machineId && !machineById(db, db.session.organisationId, machineId)) {
    return fail("NOT_FOUND", "That machine is not in the active organisation.");
  }
  return { ok: true, db: { ...db, selectedMachineId: machineId } };
}

export interface MachineInput {
  machineCode: string;
  name: string;
  description: string;
  productionLine: string;
  area: string;
  machineType: string;
  nfcTagId: string;
}

export function createMachine(
  db: DemoDatabase,
  input: MachineInput,
): OperationResult<Machine> {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const fieldErrors = validateMachine(db, session.organisationId, input, null);
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the machine details.", fieldErrors);
  }
  const now = new Date().toISOString();
  const tag = input.nfcTagId.trim();
  const machine: Machine = {
    id: newId("mach"),
    organisationId: session.organisationId,
    machineCode: input.machineCode.trim(),
    name: input.name.trim(),
    description: input.description.trim() || undefined,
    location: {
      productionLine: input.productionLine.trim() || undefined,
      area: input.area.trim() || undefined,
    },
    machineType: input.machineType.trim() || undefined,
    status: "active",
    nfc: tag
      ? { tagId: tag, enabled: true, registeredAt: now }
      : { tagId: null, enabled: false },
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ok: true,
    data: machine,
    db: {
      ...db,
      machines: [...db.machines, machine],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "machine.create",
          "machine",
          machine.id,
          `Registered ${machine.machineCode}.`,
        ),
      ],
    },
  };
}

export function updateMachine(
  db: DemoDatabase,
  machineId: string,
  input: MachineInput,
): OperationResult<Machine> {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const existing = machineById(db, session.organisationId, machineId);
  if (!existing) return fail("NOT_FOUND", "Machine not found in this organisation.");
  const fieldErrors = validateMachine(db, session.organisationId, input, machineId);
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the machine details.", fieldErrors);
  }
  const now = new Date().toISOString();
  const tag = input.nfcTagId.trim();
  const machine: Machine = {
    ...existing,
    machineCode: input.machineCode.trim(),
    name: input.name.trim(),
    description: input.description.trim() || undefined,
    location: {
      ...existing.location,
      productionLine: input.productionLine.trim() || undefined,
      area: input.area.trim() || undefined,
    },
    machineType: input.machineType.trim() || undefined,
    nfc: tag
      ? {
          tagId: tag,
          enabled: true,
          registeredAt: existing.nfc.tagId === tag ? existing.nfc.registeredAt : now,
        }
      : { tagId: null, enabled: false },
    updatedBy: session.userId,
    updatedAt: now,
  };
  return {
    ok: true,
    data: machine,
    db: {
      ...db,
      machines: db.machines.map((item) => (item.id === machine.id ? machine : item)),
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "machine.update",
          "machine",
          machine.id,
          `Updated ${machine.machineCode}.`,
        ),
      ],
    },
  };
}

function validateMachine(
  db: DemoDatabase,
  organisationId: string,
  input: MachineInput,
  ignoreId: string | null,
): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  const code = input.machineCode.trim();
  if (!/^[A-Za-z0-9-]{2,32}$/.test(code)) {
    fieldErrors.machineCode = "Use 2–32 letters, numbers, or hyphens.";
  } else if (
    db.machines.some(
      (machine) =>
        machine.organisationId === organisationId &&
        machine.id !== ignoreId &&
        machine.machineCode.toLowerCase() === code.toLowerCase(),
    )
  ) {
    fieldErrors.machineCode =
      "That machine identifier is already used in this organisation.";
  }
  if (input.name.trim().length < 2) {
    fieldErrors.name = "Enter the machine name.";
  }
  const tag = input.nfcTagId.trim();
  if (
    tag &&
    db.machines.some(
      (machine) =>
        machine.organisationId === organisationId &&
        machine.id !== ignoreId &&
        machine.nfc.tagId === tag,
    )
  ) {
    fieldErrors.nfcTagId =
      "That NFC tag is already linked to another machine in this organisation.";
  }
  return fieldErrors;
}

export function updateOrganisationSettings(
  db: DemoDatabase,
  input: { name: string; timezone: string },
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const fieldErrors: Record<string, string> = {};
  if (input.name.trim().length < 2) fieldErrors.name = "Enter the organisation name.";
  if (!input.timezone.trim()) fieldErrors.timezone = "Choose a timezone.";
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the organisation settings.", fieldErrors);
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      organisations: db.organisations.map((organisation) =>
        organisation.id === session.organisationId
          ? {
              ...organisation,
              name: input.name.trim(),
              settings: { ...organisation.settings, timezone: input.timezone },
              updatedAt: now,
            }
          : organisation,
      ),
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "organisation.update",
          "organisation",
          session.organisationId,
          "Updated organisation settings.",
        ),
      ],
    },
  };
}

export interface AddMemberInput {
  email: string;
  /** Temporary password stored for first sign-in. */
  temporaryPassword: string;
  workerAccessType: WorkerAccessType;
  accessDuration: WorkerAccessDuration;
  customExpiresAt?: string;
}

/** @deprecated Use AddMemberInput */
export type InviteWorkerInput = AddMemberInput;

export function addMember(db: DemoDatabase, input: AddMemberInput): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const normalized = normalizeEmail(input.email);
  const fieldErrors: Record<string, string> = {};
  if (!isEmail(normalized)) {
    fieldErrors.email = "Enter a valid email address.";
  }
  if (input.temporaryPassword.trim().length < 8) {
    fieldErrors.temporaryPassword = "Use at least 8 characters for the temporary password.";
  }
  const access = resolveAccessExpiry(
    input.workerAccessType,
    input.accessDuration,
    input.customExpiresAt,
  );
  if (!access.ok) {
    fieldErrors.accessDuration = access.message;
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the member details.", fieldErrors);
  }
  const existingUser = db.users.find((user) => user.emailNormalized === normalized);
  if (
    existingUser &&
    db.memberships.some(
      (membership) =>
        membership.userId === existingUser.id &&
        membership.organisationId === session.organisationId &&
        membership.status !== "removed",
    )
  ) {
    return fail("CONFLICT", "That person is already a member.", {
      email: "That person is already a member of this organisation.",
    });
  }
  if (
    db.invitations.some(
      (invitation) =>
        invitation.organisationId === session.organisationId &&
        invitation.emailNormalized === normalized &&
        invitation.status === "pending",
    )
  ) {
    return fail("CONFLICT", "That member was already added and is pending.", {
      email: "That email already has a pending membership add.",
    });
  }

  const now = new Date().toISOString();
  const recordExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const accessExpiresAt = access.ok ? access.accessExpiresAt : null;

  const userId = existingUser?.id ?? newId("user");
  const users = existingUser
    ? db.users.map((user) =>
        user.id === existingUser.id ? withAuthProvider(user, "password") : user,
      )
    : [
        ...db.users,
        {
          id: userId,
          email: normalized,
          emailNormalized: normalized,
          displayName: normalized.split("@")[0] ?? normalized,
          authProviders: ["password" as const],
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
        },
      ];

  const membership: Membership = {
    id: newId("memship"),
    organisationId: session.organisationId,
    userId,
    role: "worker",
    status: "active",
    workerAccessType: input.workerAccessType,
    accessExpiresAt,
    accessDurationPreset: input.accessDuration,
    joinedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const withMembership: DemoDatabase = {
    ...db,
    users,
    memberships: [...db.memberships, membership],
    invitations: [
      ...db.invitations,
      {
        id: newId("invite"),
        organisationId: session.organisationId,
        emailNormalized: normalized,
        role: "worker",
        workerAccessType: input.workerAccessType,
        accessDurationPreset: input.accessDuration,
        accessExpiresAt,
        status: "accepted",
        invitedBy: session.userId,
        expiresAt: recordExpires,
        createdAt: now,
        updatedAt: now,
      },
    ],
    preferences: {
      ...db.preferences,
      [userId]: db.preferences[userId] ?? {
        emailAlerts: true,
        showVoiceTextFirst: false,
      },
    },
    auditEvents: [
      ...db.auditEvents,
      audit(
        session,
        "membership.add",
        "membership",
        membership.id,
        `Added a ${input.workerAccessType} member with a temporary password.`,
      ),
    ],
  };

  return {
    ok: true,
    db: setCredential(withMembership, userId, input.temporaryPassword.trim(), true),
  };
}

/** @deprecated Use addMember */
export const inviteWorker = addMember;

export function leaveOrganisation(db: DemoDatabase): OperationResult {
  const session = db.session;
  if (!session) return fail("FORBIDDEN", "Sign in is required.");
  const membership = db.memberships.find(
    (item) =>
      item.userId === session.userId &&
      item.organisationId === session.organisationId &&
      item.status !== "removed",
  );
  if (!membership) {
    return fail("NOT_FOUND", "No active membership was found for this organisation.");
  }
  if (membership.role === "admin") {
    const otherAdmins = db.memberships.filter(
      (item) =>
        item.organisationId === session.organisationId &&
        item.role === "admin" &&
        item.status === "active" &&
        item.userId !== session.userId,
    );
    if (otherAdmins.length === 0) {
      return fail(
        "FORBIDDEN",
        "You are the only administrator. Add another administrator before leaving.",
      );
    }
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      memberships: db.memberships.map((item) =>
        item.id === membership.id
          ? { ...item, status: "removed" as const, updatedAt: now }
          : item,
      ),
      session: null,
      selectedMachineId: null,
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "membership.leave",
          "membership",
          membership.id,
          "Member left the organisation.",
        ),
      ],
    },
  };
}

export function removeMember(
  db: DemoDatabase,
  membershipId: string,
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const membership = db.memberships.find(
    (item) =>
      item.id === membershipId &&
      item.organisationId === session.organisationId &&
      item.status !== "removed",
  );
  if (!membership) return fail("NOT_FOUND", "Membership not found.");
  if (membership.userId === session.userId) {
    return fail(
      "VALIDATION",
      "You cannot remove yourself here. Use Leave organisation in Settings.",
    );
  }
  if (membership.role === "admin") {
    const otherAdmins = db.memberships.filter(
      (item) =>
        item.organisationId === session.organisationId &&
        item.role === "admin" &&
        item.status === "active" &&
        item.id !== membership.id,
    );
    if (otherAdmins.length === 0) {
      return fail(
        "FORBIDDEN",
        "Cannot remove the only active administrator.",
      );
    }
  }
  const now = new Date().toISOString();
  const user = db.users.find((item) => item.id === membership.userId);
  return {
    ok: true,
    db: {
      ...db,
      memberships: db.memberships.map((item) =>
        item.id === membership.id
          ? { ...item, status: "removed" as const, updatedAt: now }
          : item,
      ),
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "membership.remove",
          "membership",
          membership.id,
          `Removed ${user?.displayName ?? "member"} from the organisation.`,
        ),
      ],
    },
  };
}

export function setPermanentWorkerSuspension(
  db: DemoDatabase,
  membershipId: string,
  suspended: boolean,
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const membership = db.memberships.find(
    (item) =>
      item.id === membershipId && item.organisationId === session.organisationId,
  );
  if (!membership) return fail("NOT_FOUND", "Membership not found.");
  if (membership.role !== "worker") {
    return fail("VALIDATION", "Administrators are not suspended through this control.");
  }
  if (workerAccessTypeOf(membership) !== "permanent") {
    return fail(
      "VALIDATION",
      "Temporary workers are limited by an expiry date. They cannot be suspended.",
    );
  }
  if (membership.status === "removed") {
    return fail("VALIDATION", "A removed membership cannot be suspended.");
  }
  const now = new Date().toISOString();
  const nextStatus = suspended ? "suspended" : "active";
  return {
    ok: true,
    db: {
      ...db,
      memberships: db.memberships.map((item) =>
        item.id === membership.id
          ? { ...item, status: nextStatus, updatedAt: now }
          : item,
      ),
      session:
        db.session?.userId === membership.userId && suspended
          ? null
          : db.session,
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          suspended ? "membership.suspend" : "membership.restore",
          "membership",
          membership.id,
          suspended
            ? "Suspended a permanent worker."
            : "Restored a permanent worker.",
        ),
      ],
    },
  };
}

export function updateWorkerAccessWindow(
  db: DemoDatabase,
  membershipId: string,
  input: {
    workerAccessType: WorkerAccessType;
    accessDuration: WorkerAccessDuration;
    customExpiresAt?: string;
  },
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const membership = db.memberships.find(
    (item) =>
      item.id === membershipId && item.organisationId === session.organisationId,
  );
  if (!membership) return fail("NOT_FOUND", "Membership not found.");
  if (membership.role !== "worker") {
    return fail("VALIDATION", "Only worker memberships have an access window.");
  }
  const access = resolveAccessExpiry(
    input.workerAccessType,
    input.accessDuration,
    input.customExpiresAt,
  );
  if (!access.ok) {
    return fail("VALIDATION", access.message, { accessDuration: access.message });
  }
  const now = new Date().toISOString();
  const nextStatus =
    input.workerAccessType === "temporary" && membership.status === "suspended"
      ? "active"
      : membership.status;
  const updated: Membership = {
    ...membership,
    workerAccessType: input.workerAccessType,
    accessDurationPreset: input.accessDuration,
    accessExpiresAt: access.accessExpiresAt,
    status: nextStatus,
    updatedAt: now,
  };
  return {
    ok: true,
    db: {
      ...db,
      memberships: db.memberships.map((item) =>
        item.id === membership.id ? updated : item,
      ),
      session:
        db.session?.userId === membership.userId
          ? {
              ...db.session,
              workerAccessType: input.workerAccessType,
              accessExpiresAt: access.accessExpiresAt,
            }
          : db.session,
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "membership.access_update",
          "membership",
          membership.id,
          `Set ${input.workerAccessType} access (${input.accessDuration}).`,
        ),
      ],
    },
  };
}

export function updateMemory(
  db: DemoDatabase,
  memoryId: string,
  draft: EditableMemory,
  expectedRevision: number,
  changes: FieldChange[],
): OperationResult<MemoryRecord> {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  if (changes.length === 0) {
    return fail("VALIDATION", "There are no changes to save.");
  }
  const current = memoryById(db, session.organisationId, memoryId);
  if (!current) return fail("NOT_FOUND", "Memory not found in this organisation.");
  if (current.currentRevision !== expectedRevision) {
    return fail(
      "CONFLICT",
      "This record changed before the update was confirmed. Reload it and review the latest version.",
    );
  }
  const now = new Date().toISOString();
  const next = applyDraft(current, draft);
  const updated: MemoryRecord = {
    ...next,
    currentRevision: current.currentRevision + 1,
    updatedBy: session.userId,
    updatedAt: now,
    verifiedAt: next.status === "verified" ? now : current.verifiedAt,
  };
  const summary = changes
    .map((change) => `${change.label}: ${change.before || "—"} → ${change.after || "—"}`)
    .join("; ");
  return {
    ok: true,
    data: updated,
    db: {
      ...db,
      memories: db.memories.map((memory) =>
        memory.id === current.id ? updated : memory,
      ),
      revisions: [
        ...db.revisions,
        {
          id: newId("rev"),
          organisationId: session.organisationId,
          memoryId: current.id,
          revisionNumber: updated.currentRevision,
          snapshot: {
            type: updated.type,
            title: updated.title,
            content: updated.content,
            summary: updated.summary,
            status: updated.status,
            tags: updated.tags,
          },
          changeSummary: summary,
          changedBy: session.userId,
          createdAt: now,
        },
      ],
      auditEvents: [
        ...db.auditEvents,
        audit(session, "memory.update", "memory", current.id, summary),
      ],
    },
  };
}

export interface ReportInput {
  machineId: string;
  title: string;
  content: string;
  type: MemoryType;
  sourceType: MemorySourceType;
}

export function createReport(
  db: DemoDatabase,
  input: ReportInput,
): OperationResult<MemoryRecord> {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  const machine = machineById(db, session.organisationId, input.machineId);
  const fieldErrors: Record<string, string> = {};
  if (!machine) fieldErrors.machineId = "Choose a machine in this organisation.";
  if (machine?.status === "inactive") {
    fieldErrors.machineId =
      "That machine is inactive. Choose an active machine or ask an administrator.";
  }
  if (input.title.trim().length < 3) fieldErrors.title = "Enter a short title.";
  if (input.content.trim().length < 12) {
    fieldErrors.content = "Describe what happened in at least 12 characters.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "The report is incomplete.", fieldErrors);
  }
  const now = new Date().toISOString();
  const memory: MemoryRecord = {
    id: newId("mem"),
    organisationId: session.organisationId,
    machineId: input.machineId,
    type: input.type,
    title: input.title.trim(),
    content: input.content.trim(),
    summary: input.content.trim().slice(0, 140),
    status: "pending_review",
    source: { type: input.sourceType, submittedBy: session.userId },
    tags: [],
    currentRevision: 1,
    example: false,
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };
  const alertId = newId("alert");
  return {
    ok: true,
    data: memory,
    db: {
      ...db,
      memories: [memory, ...db.memories],
      revisions: [
        ...db.revisions,
        {
          id: newId("rev"),
          organisationId: session.organisationId,
          memoryId: memory.id,
          revisionNumber: 1,
          snapshot: {
            type: memory.type,
            title: memory.title,
            content: memory.content,
            summary: memory.summary,
            status: memory.status,
            tags: [],
          },
          changeSummary: "Initial report",
          changedBy: session.userId,
          createdAt: now,
        },
      ],
      alerts: [
        {
          id: alertId,
          organisationId: session.organisationId,
          machineId: memory.machineId,
          type: "new_report",
          severity: "info",
          title: "New report pending review",
          message: `${session.displayName} submitted “${memory.title}”. Status is pending review. Shown under machine information, not Live Alerts.`,
          status: "open",
          sourceType: "memory",
          sourceId: memory.id,
          createdAt: now,
        },
        ...db.alerts,
      ],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "memory.create",
          "memory",
          memory.id,
          "Submitted a new operational report.",
        ),
      ],
    },
  };
}

export function acknowledgeAlert(db: DemoDatabase, alertId: string): OperationResult {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  const alert = db.alerts.find(
    (item) => item.id === alertId && item.organisationId === session.organisationId,
  );
  if (!alert) return fail("NOT_FOUND", "Alert not found in this organisation.");
  if (alert.status === "acknowledged" || alert.status === "resolved") {
    return { ok: true, db };
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      alerts: db.alerts.map((item) =>
        item.id === alert.id
          ? {
              ...item,
              status: "acknowledged",
              acknowledgedBy: session.userId,
              acknowledgedAt: now,
            }
          : item,
      ),
    },
  };
}

export function resolveAlert(db: DemoDatabase, alertId: string): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const alert = db.alerts.find(
    (item) => item.id === alertId && item.organisationId === session.organisationId,
  );
  if (!alert) return fail("NOT_FOUND", "Alert not found in this organisation.");
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      alerts: db.alerts.map((item) =>
        item.id === alert.id ? { ...item, status: "resolved", resolvedAt: now } : item,
      ),
      auditEvents: [
        ...db.auditEvents,
        audit(session, "alert.resolve", "alert", alert.id, "Marked the alert resolved."),
      ],
    },
  };
}

export interface DailyWorkLogInput {
  machineId: string;
  title: string;
  content: string;
  /** Optional ISO date for the work day (defaults to today). */
  workDate?: string;
}

/**
 * Worker manual daily work log (text) — stored as an operational_note memory.
 */
export function createDailyWorkLog(
  db: DemoDatabase,
  input: DailyWorkLogInput,
): OperationResult<MemoryRecord> {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  if (session.role !== "worker" && session.role !== "admin") {
    return fail("FORBIDDEN", "Only organisation members can add work logs.");
  }
  const fieldErrors: Record<string, string> = {};
  const machine = machineById(db, session.organisationId, input.machineId);
  if (!machine) fieldErrors.machineId = "Choose a machine in this organisation.";
  if (input.title.trim().length < 3) {
    fieldErrors.title = "Enter a short title for today’s work.";
  }
  if (input.content.trim().length < 12) {
    fieldErrors.content = "Describe the work done in at least 12 characters.";
  }
  let workDay = new Date();
  if (input.workDate?.trim()) {
    const parsed = new Date(input.workDate);
    if (Number.isNaN(parsed.getTime())) {
      fieldErrors.workDate = "Choose a valid work date.";
    } else {
      workDay = parsed;
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the work log.", fieldErrors);
  }

  const now = new Date().toISOString();
  const dayLabel = workDay.toISOString().slice(0, 10);
  const title = input.title.trim();
  const content = input.content.trim();
  const memory: MemoryRecord = {
    id: newId("mem"),
    organisationId: session.organisationId,
    machineId: input.machineId,
    type: "operational_note",
    title: `${dayLabel}: ${title}`,
    content: `${content}\n\nWork date: ${dayLabel}. Logged by ${session.displayName}.`,
    summary: content.slice(0, 140),
    status: "verified",
    source: { type: "text", submittedBy: session.userId },
    tags: ["work-log", "daily", dayLabel],
    currentRevision: 1,
    example: false,
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
    verifiedAt: now,
  };

  return {
    ok: true,
    data: memory,
    db: {
      ...db,
      memories: [memory, ...db.memories],
      revisions: [
        {
          id: newId("rev"),
          organisationId: session.organisationId,
          memoryId: memory.id,
          revisionNumber: 1,
          snapshot: {
            type: memory.type,
            title: memory.title,
            content: memory.content,
            summary: memory.summary,
            status: memory.status,
            tags: memory.tags,
          },
          changeSummary: "Daily work log",
          changedBy: session.userId,
          createdAt: now,
        },
        ...db.revisions,
      ],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "memory.create",
          "memory",
          memory.id,
          `Logged daily work on ${machine!.machineCode}.`,
        ),
      ],
    },
  };
}

function isOverheatingAlert(alert: Alert): boolean {
  if (alert.issueKind === "overheating") return true;
  if (alert.severity === "critical" && alert.type === "machine_hazard") return true;
  return /overheat/i.test(alert.title) || /overheat/i.test(alert.message);
}

/**
 * Worker voice MVP: clear overheating Live Alerts for a machine and write a resolution log.
 */
export function resolveOverheatingByVoice(
  db: DemoDatabase,
  machineId: string,
): OperationResult<{ message: string; removedAlertIds: string[]; memoryId: string }> {
  const session = db.session;
  if (!session) return fail("FORBIDDEN", "Sign in is required.");
  if (session.role !== "worker" && session.role !== "admin") {
    return fail("FORBIDDEN", "Only organisation members can resolve overheating by voice.");
  }
  const machine = machineById(db, session.organisationId, machineId);
  if (!machine) return fail("NOT_FOUND", "Machine not found.");
  const toRemove = db.alerts.filter(
    (alert) =>
      alert.organisationId === session.organisationId &&
      alert.machineId === machineId &&
      alert.status !== "resolved" &&
      alert.status !== "dismissed" &&
      isOverheatingAlert(alert),
  );
  const now = new Date().toISOString();
  const memoryId = newId("mem");
  const logTitle = `Overheating issue solved by ${session.displayName}`;
  const logContent = `${session.displayName} cleared the overheating hold on ${machine.machineCode} via Voice Assistant. Database record updated.`;
  const memory: MemoryRecord = {
    id: memoryId,
    organisationId: session.organisationId,
    machineId,
    type: "incident",
    title: logTitle,
    content: logContent,
    summary: logTitle,
    status: "verified",
    source: { type: "voice", submittedBy: session.userId },
    tags: ["overheating", "voice", "resolved"],
    currentRevision: 1,
    example: false,
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
    verifiedAt: now,
  };
  const message = `Database record updated. New log created: Overheating issue solved by ${session.displayName}`;
  return {
    ok: true,
    data: {
      message,
      removedAlertIds: toRemove.map((alert) => alert.id),
      memoryId,
    },
    db: {
      ...db,
      alerts: db.alerts.filter((alert) => !toRemove.some((item) => item.id === alert.id)),
      memories: [memory, ...db.memories],
      revisions: [
        {
          id: newId("rev"),
          organisationId: session.organisationId,
          memoryId,
          revisionNumber: 1,
          snapshot: {
            type: memory.type,
            title: memory.title,
            content: memory.content,
            summary: memory.summary,
            status: memory.status,
            tags: memory.tags,
          },
          changeSummary: "Voice resolution log",
          changedBy: session.userId,
          createdAt: now,
        },
        ...db.revisions,
      ],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "alert.voice_resolve_overheating",
          "machine",
          machineId,
          message,
        ),
      ],
    },
  };
}

/** Administrator decision on AI false-report screening for an issue photo. */
export function reviewIssuePhotoAi(
  db: DemoDatabase,
  alertId: string,
  decision: "cleared" | "flagged_false",
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const alert = db.alerts.find(
    (item) => item.id === alertId && item.organisationId === session.organisationId,
  );
  if (!alert) return fail("NOT_FOUND", "Alert not found in this organisation.");
  if (!alert.photoAiReview) {
    return fail("VALIDATION", "This alert has no photo screening to review.");
  }
  if (
    alert.photoAiReview.status !== "needs_admin_review" &&
    alert.photoAiReview.status !== "flagged_false" &&
    alert.photoAiReview.status !== "queued"
  ) {
    return fail("VALIDATION", "This photo screening has already been decided.");
  }
  const now = new Date().toISOString();
  const note =
    decision === "cleared"
      ? "Administrator approved this report. The photo was treated as plausible."
      : "Administrator marked this as a false report after reviewing the photo.";
  return {
    ok: true,
    db: {
      ...db,
      alerts: db.alerts.map((item) =>
        item.id === alert.id
          ? {
              ...item,
              photoAiReview: {
                status: decision,
                note,
                updatedAt: now,
              },
              ...(decision === "flagged_false"
                ? { status: "dismissed" as const, resolvedAt: now }
                : {}),
            }
          : item,
      ),
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          decision === "cleared" ? "alert.photo_cleared" : "alert.photo_flagged_false",
          "alert",
          alert.id,
          decision === "cleared"
            ? "Approved the issue report after photo review."
            : "Denied the issue report as a false report after photo review.",
        ),
      ],
    },
  };
}

export function generateHandover(db: DemoDatabase): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const now = new Date();
  const memories = db.memories.filter(
    (memory) => memory.organisationId === session.organisationId,
  );
  const activeConstraints = db.constraints.filter(
    (constraint) =>
      constraint.organisationId === session.organisationId &&
      isConstraintActive(constraint, now),
  );
  const unresolved = memories.filter(
    (memory) => memory.status === "unresolved" || memory.status === "pending_review",
  );
  if (memories.length === 0 && activeConstraints.length === 0) {
    return fail(
      "VALIDATION",
      "There are no operational records to summarise. Add a report before generating a handover.",
    );
  }
  const machineIds = [...new Set(memories.map((memory) => memory.machineId))];
  const lines = [
    "Draft summary assembled in this browser from the records currently in the session. No AI model was called.",
    unresolved.length
      ? `${unresolved.length} report${unresolved.length === 1 ? "" : "s"} still need review or remain unresolved.`
      : "No unresolved or pending reports were in the session.",
    activeConstraints.length
      ? `${activeConstraints.length} constraint${activeConstraints.length === 1 ? "" : "s"} are inside an active time window.`
      : "No constraints are currently active.",
    "Quoted operator reports are listed separately and were not rewritten as verified facts.",
  ];
  const timestamp = now.toISOString();
  const handover = {
    id: newId("hov"),
    organisationId: session.organisationId,
    machineIds,
    createdBy: session.userId,
    title: `Draft handover ${timestamp.slice(0, 16).replace("T", " ")} UTC`,
    summary: lines.join(" "),
    summaryKind: "generated" as const,
    memoryIds: memories.map((memory) => memory.id),
    constraintIds: activeConstraints.map((constraint) => constraint.id),
    status: "draft" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { ok: true, db: { ...db, handovers: [handover, ...db.handovers] } };
}

export function publishHandover(db: DemoDatabase, handoverId: string): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const handover = db.handovers.find(
    (item) => item.id === handoverId && item.organisationId === session.organisationId,
  );
  if (!handover) return fail("NOT_FOUND", "Handover not found.");
  if (handover.status !== "draft") {
    return fail("CONFLICT", "Only a draft handover can be published.");
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      handovers: db.handovers.map((item) =>
        item.id === handover.id
          ? { ...item, status: "published", publishedAt: now, updatedAt: now }
          : item,
      ),
    },
  };
}

export function acknowledgeHandover(
  db: DemoDatabase,
  handoverId: string,
): OperationResult {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  const handover = db.handovers.find(
    (item) => item.id === handoverId && item.organisationId === session.organisationId,
  );
  if (!handover) return fail("NOT_FOUND", "Handover not found.");
  if (handover.status !== "published") {
    return fail("CONFLICT", "Only a published handover can be acknowledged.");
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      handovers: db.handovers.map((item) =>
        item.id === handover.id
          ? {
              ...item,
              status: "acknowledged",
              acknowledgedBy: session.userId,
              acknowledgedAt: now,
              updatedAt: now,
            }
          : item,
      ),
    },
  };
}

export interface ReportMachineIssueInput {
  machineId: string;
  issueKind: MachineIssueKind;
  title: string;
  description: string;
  /** ISO end of the do-not-operate / alert window. */
  expiresAt: string;
  photoDataUrl: string;
  photoName: string;
  photoBytes: number;
  photoSource: "camera" | "upload";
}

export function reportMachineIssue(
  db: DemoDatabase,
  input: ReportMachineIssueInput,
): OperationResult<Alert> {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  const fieldErrors: Record<string, string> = {};
  const machine = machineById(db, session.organisationId, input.machineId);
  if (!machine) {
    fieldErrors.machineId = "Choose a machine in this organisation.";
  }
  if (input.title.trim().length < 3) {
    fieldErrors.title = "Enter a short title for the issue.";
  }
  if (input.description.trim().length < 8) {
    fieldErrors.description = "Describe the issue in at least 8 characters.";
  }
  const expires = new Date(input.expiresAt);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) {
    fieldErrors.expiresAt = "Choose an end time in the future for this alert.";
  }
  if (!input.photoDataUrl?.startsWith("data:image/")) {
    fieldErrors.photo = "Take a photo with the camera or upload an image of the issue.";
  } else if (input.photoBytes > MAX_ISSUE_PHOTO_BYTES) {
    fieldErrors.photo = "Use a photo smaller than about 1.5 MB for this preview.";
  }
  if (input.photoSource !== "camera" && input.photoSource !== "upload") {
    fieldErrors.photo = "Take a photo with the camera or upload an image of the issue.";
  }
  const issueKinds: MachineIssueKind[] = [
    "breakdown",
    "damage",
    "maintenance",
    "overheating",
    "unsafe",
  ];
  if (!issueKinds.includes(input.issueKind)) {
    fieldErrors.issueKind = "Choose what kind of issue this is.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the issue report.", fieldErrors);
  }

  const now = new Date().toISOString();
  const kindLabel = labelMachineIssueKind(input.issueKind);
  const title = input.title.trim();
  const description = input.description.trim();
  const alertType = alertTypeForIssue(input.issueKind);
  const severity = severityForIssue(input.issueKind);
  const doNotOperate =
    input.issueKind === "maintenance" ||
    input.issueKind === "overheating" ||
    input.issueKind === "unsafe" ||
    input.issueKind === "breakdown" ||
    input.issueKind === "damage";

  const memory: MemoryRecord = {
    id: newId("mem"),
    organisationId: session.organisationId,
    machineId: input.machineId,
    type: input.issueKind === "maintenance" ? "maintenance" : "incident",
    title,
    content: `${description}\n\nIssue kind: ${kindLabel}. Alert window until ${expires.toISOString()}. A photo was ${input.photoSource === "camera" ? "taken with the camera" : "uploaded"} in this browser session and queued for AI false-report screening.`,
    summary: description.slice(0, 140),
    status: "unresolved",
    source: { type: "text", submittedBy: session.userId },
    tags: ["issue-report", input.issueKind, `photo-${input.photoSource}`],
    currentRevision: 1,
    example: false,
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };

  const photoAiReview = {
    status: "needs_admin_review" as const,
    note:
      "Photo queued for AI false-report screening. AI analysis is not run in this preview; an administrator should review the photo and decide whether the report looks false.",
    updatedAt: now,
  };

  const alert: Alert = {
    id: newId("alert"),
    organisationId: session.organisationId,
    machineId: input.machineId,
    type: alertType,
    severity,
    title: doNotOperate
      ? `${machine!.machineCode}: ${title} — do not operate until window ends`
      : `${machine!.machineCode}: ${title}`,
    message: doNotOperate
      ? `${machine!.machineCode} (${machine!.name}) — ${kindLabel}. ${description} No personnel should operate this machine until ${expires.toISOString()}. Reported by ${session.displayName}. Photo awaiting admin review for possible false reporting.`
      : `${machine!.machineCode} (${machine!.name}) — ${kindLabel}. ${description} Reported by ${session.displayName}. Photo awaiting admin review for possible false reporting.`,
    status: "open",
    sourceType: "issue_report",
    sourceId: memory.id,
    expiresAt: expires.toISOString(),
    photoDataUrl: input.photoDataUrl,
    photoName:
      input.photoName ||
      (input.photoSource === "camera" ? "camera-capture.jpg" : "issue-photo.jpg"),
    photoSource: input.photoSource,
    photoAiReview,
    issueKind: input.issueKind,
    reportedBy: session.userId,
    createdAt: now,
  };

  const nextMachines =
    input.issueKind === "maintenance" || input.issueKind === "breakdown"
      ? db.machines.map((item) =>
          item.id === machine!.id
            ? { ...item, status: "maintenance" as const, updatedAt: now }
            : item,
        )
      : db.machines;

  return {
    ok: true,
    data: alert,
    db: {
      ...db,
      machines: nextMachines,
      memories: [memory, ...db.memories],
      revisions: [
        ...db.revisions,
        {
          id: newId("rev"),
          organisationId: session.organisationId,
          memoryId: memory.id,
          revisionNumber: 1,
          snapshot: {
            type: memory.type,
            title: memory.title,
            content: memory.content,
            summary: memory.summary,
            status: memory.status,
            tags: memory.tags,
          },
          changeSummary: "Machine issue report",
          changedBy: session.userId,
          createdAt: now,
        },
      ],
      alerts: [alert, ...db.alerts],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "alert.issue_report",
          "alert",
          alert.id,
          `Reported ${kindLabel} on ${machine!.machineCode}.`,
        ),
      ],
    },
  };
}

export interface CreateTaskInput {
  assigneeUserId: string;
  machineId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  dueAt?: string;
}

export function createTask(
  db: DemoDatabase,
  input: CreateTaskInput,
): OperationResult<Task> {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const fieldErrors: Record<string, string> = {};
  if (input.title.trim().length < 3) {
    fieldErrors.title = "Enter a short task title.";
  }
  const membership = db.memberships.find(
    (item) =>
      item.organisationId === session.organisationId &&
      item.userId === input.assigneeUserId &&
      item.role === "worker",
  );
  if (!membership || membershipAccessState(membership) !== "active") {
    fieldErrors.assigneeUserId = "Choose an active worker in this organisation.";
  }
  if (input.machineId.trim()) {
    if (!machineById(db, session.organisationId, input.machineId)) {
      fieldErrors.machineId = "Choose a machine in this organisation.";
    }
  }
  if (!["low", "medium", "high", "urgent"].includes(input.priority)) {
    fieldErrors.priority = "Choose a priority.";
  }
  let dueAt: string | undefined;
  if (input.dueAt?.trim()) {
    const due = new Date(input.dueAt);
    if (Number.isNaN(due.getTime())) {
      fieldErrors.dueAt = "Enter a valid due date and time.";
    } else {
      dueAt = due.toISOString();
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the task details.", fieldErrors);
  }
  const now = new Date().toISOString();
  const task: Task = {
    id: newId("task"),
    organisationId: session.organisationId,
    assigneeUserId: input.assigneeUserId,
    assignedBy: session.userId,
    machineId: input.machineId.trim() || undefined,
    title: input.title.trim(),
    description: input.description.trim(),
    priority: input.priority,
    status: "open",
    dueAt,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ok: true,
    data: task,
    db: {
      ...db,
      tasks: [task, ...(db.tasks ?? [])],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "task.create",
          "task",
          task.id,
          `Assigned “${task.title}” (${task.priority}) to a worker.`,
        ),
      ],
    },
  };
}

export function acceptShiftAssignment(
  db: DemoDatabase,
  assignmentId: string,
): OperationResult {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  const assignment = db.assignments.find(
    (item) =>
      item.id === assignmentId && item.organisationId === session.organisationId,
  );
  if (!assignment) {
    return fail("NOT_FOUND", "That shift assignment was not found.");
  }
  if (assignment.userId !== session.userId && session.role !== "admin") {
    return fail("FORBIDDEN", "Only the assigned worker can acknowledge this assignment.");
  }
  if (assignment.status === "accepted" || assignment.status === "completed") {
    return { ok: true, db };
  }
  if (assignment.status === "cancelled") {
    return fail("CONFLICT", "A cancelled assignment cannot be acknowledged.");
  }
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      assignments: db.assignments.map((item) =>
        item.id === assignment.id
          ? { ...item, status: "accepted" as const, updatedAt: now }
          : item,
      ),
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "assignment.accept",
          "assignment",
          assignment.id,
          "Acknowledged a shift assignment.",
        ),
      ],
    },
  };
}

export function updateTaskStatus(
  db: DemoDatabase,
  taskId: string,
  status: TaskStatus,
): OperationResult<Task> {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const session = db.session;
  const task = (db.tasks ?? []).find(
    (item) => item.id === taskId && item.organisationId === session.organisationId,
  );
  if (!task) return fail("NOT_FOUND", "Task not found in this organisation.");
  const isAdmin = session.role === "admin";
  const isAssignee = task.assigneeUserId === session.userId;
  if (!isAdmin && !isAssignee) {
    return fail("FORBIDDEN", "Only the assigned worker or an administrator can update this task.");
  }
  if (!isAdmin && status === "cancelled") {
    return fail("FORBIDDEN", "Workers cannot cancel a task. Ask an administrator.");
  }
  if (task.status === "cancelled" && status !== "cancelled") {
    return fail("CONFLICT", "A cancelled task cannot be reopened in this preview.");
  }
  if (task.status === "completed" && status === "open") {
    return fail("CONFLICT", "A completed task cannot return to open in this preview.");
  }
  const now = new Date().toISOString();
  const updated: Task = {
    ...task,
    status,
    updatedAt: now,
    completedAt: status === "completed" ? now : task.completedAt,
  };
  return {
    ok: true,
    data: updated,
    db: {
      ...db,
      tasks: (db.tasks ?? []).map((item) => (item.id === task.id ? updated : item)),
      auditEvents: [
        ...db.auditEvents,
        audit(session, "task.status", "task", task.id, `Task status set to ${status}.`),
      ],
    },
  };
}

export interface UpdateShiftPolicyInput {
  templates: ShiftTemplate[];
  rotation: ShiftRotation;
  minRestHoursBetweenShifts: number;
}

export function updateShiftPolicy(
  db: DemoDatabase,
  input: UpdateShiftPolicyInput,
  now = new Date(),
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  if (!organisation) return fail("NOT_FOUND", "Organisation not found.");
  const current = shiftPolicyOf(organisation);
  const fieldErrors: Record<string, string> = {};
  if (!["weekly", "fortnightly"].includes(input.rotation)) {
    fieldErrors.rotation = "Choose weekly or fortnightly rotation.";
  }
  if (
    !Number.isFinite(input.minRestHoursBetweenShifts) ||
    input.minRestHoursBetweenShifts < 1 ||
    input.minRestHoursBetweenShifts > 24
  ) {
    fieldErrors.minRestHoursBetweenShifts =
      "Rest window must be between 1 and 24 hours.";
  }
  for (const kind of ["morning", "afternoon", "night"] as ShiftKind[]) {
    const template = input.templates.find((item) => item.kind === kind);
    if (!template) {
      fieldErrors.templates = "Morning, Afternoon, and Night templates are required.";
      break;
    }
    if (!/^\d{2}:\d{2}$/.test(template.startLocal)) {
      fieldErrors[`start_${kind}`] = `Enter a valid start time for ${kind}.`;
    }
    if (
      !Number.isInteger(template.durationMinutes) ||
      template.durationMinutes < 60 ||
      template.durationMinutes > 12 * 60
    ) {
      fieldErrors[`duration_${kind}`] =
        `Duration for ${kind} must be between 60 and 720 minutes.`;
    }
  }
  const timingTouched = templatesChanged(current.templates, input.templates);
  if (timingTouched) {
    const gate = timingChangeAllowed(current, now);
    if (!gate.allowed) {
      return fail("CONFLICT", gate.message);
    }
  }
  if (Object.keys(fieldErrors).length > 0) {
    return fail("VALIDATION", "Check the shift schedule settings.", fieldErrors);
  }

  const nextPolicy: OrganisationShiftPolicy = {
    ...current,
    templates: input.templates.map((template) => ({
      ...template,
      label:
        template.kind === "morning"
          ? "Morning"
          : template.kind === "afternoon"
            ? "Afternoon"
            : "Night",
    })),
    rotation: input.rotation,
    minRestHoursBetweenShifts: input.minRestHoursBetweenShifts,
    lastTimingChangedAt: timingTouched
      ? now.toISOString()
      : current.lastTimingChangedAt,
  };

  const timestamp = now.toISOString();
  const nextShifts = timingTouched
    ? db.shifts.map((shift) => {
        if (shift.organisationId !== session.organisationId) return shift;
        const kind = ensureShiftKind(shift);
        const template = nextPolicy.templates.find((item) => item.kind === kind);
        if (!template) return shift;
        const durationMs = template.durationMinutes * 60_000;
        // Keep the existing calendar day; rebuild length from the new duration using current start.
        // Start-time retargeting of historic/demo instances stays as stored until regenerated.
        return {
          ...shift,
          kind,
          name: template.label,
          endAt: new Date(new Date(shift.startAt).getTime() + durationMs).toISOString(),
          updatedAt: timestamp,
        };
      })
    : db.shifts;

  return {
    ok: true,
    db: {
      ...db,
      organisations: db.organisations.map((item) =>
        item.id === organisation.id
          ? {
              ...item,
              settings: { ...item.settings, shiftPolicy: nextPolicy },
              updatedAt: timestamp,
            }
          : item,
      ),
      shifts: nextShifts,
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "shift_policy.update",
          "organisation",
          organisation.id,
          timingTouched
            ? "Updated shift timings and rotation policy."
            : "Updated shift rotation or rest policy.",
        ),
      ],
    },
  };
}

export interface AssignWorkerToShiftInput {
  shiftId: string;
  userId: string;
  machineIds: string[];
}

export function assignWorkerToShift(
  db: DemoDatabase,
  input: AssignWorkerToShiftInput,
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const organisation = db.organisations.find(
    (item) => item.id === session.organisationId,
  );
  if (!organisation) return fail("NOT_FOUND", "Organisation not found.");
  const policy = shiftPolicyOf(organisation);
  const shift = db.shifts.find(
    (item) => item.id === input.shiftId && item.organisationId === session.organisationId,
  );
  if (!shift) {
    return fail("NOT_FOUND", "Shift not found in this organisation.", {
      shiftId: "Choose a shift.",
    });
  }
  const membership = db.memberships.find(
    (item) =>
      item.organisationId === session.organisationId &&
      item.userId === input.userId &&
      item.role === "worker" &&
      membershipAccessState(item) === "active",
  );
  if (!membership) {
    return fail("VALIDATION", "Choose an active worker.", {
      userId: "Choose an active worker in this organisation.",
    });
  }
  const machineIds = input.machineIds.filter((machineId) =>
    Boolean(machineById(db, session.organisationId, machineId)),
  );
  const duplicate = db.assignments.find(
    (item) =>
      item.organisationId === session.organisationId &&
      item.shiftId === shift.id &&
      item.userId === input.userId &&
      item.status !== "cancelled",
  );
  if (duplicate) {
    return fail("CONFLICT", "That worker is already assigned to this shift.", {
      userId: "That worker is already on this shift.",
    });
  }

  const otherShifts = db.assignments
    .filter(
      (item) =>
        item.organisationId === session.organisationId &&
        item.userId === input.userId &&
        item.status !== "cancelled" &&
        item.shiftId !== shift.id,
    )
    .map((item) => db.shifts.find((candidate) => candidate.id === item.shiftId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const restError = restWindowViolation(
    shift,
    otherShifts,
    policy.minRestHoursBetweenShifts,
  );
  if (restError) {
    return fail("CONFLICT", restError, { userId: restError });
  }

  const now = new Date().toISOString();
  const assignment = {
    id: newId("asg"),
    organisationId: session.organisationId,
    shiftId: shift.id,
    userId: input.userId,
    machineIds,
    status: "assigned" as const,
    assignedBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ok: true,
    db: {
      ...db,
      assignments: [...db.assignments, assignment],
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "shift.assign",
          "shift_assignment",
          assignment.id,
          `Assigned a worker to ${shift.name}.`,
        ),
      ],
    },
  };
}

export function removeShiftAssignment(
  db: DemoDatabase,
  assignmentId: string,
): OperationResult {
  const session = requireAdmin(db);
  if (!isSession(session)) return session;
  const assignment = db.assignments.find(
    (item) =>
      item.id === assignmentId && item.organisationId === session.organisationId,
  );
  if (!assignment) return fail("NOT_FOUND", "Assignment not found.");
  const now = new Date().toISOString();
  return {
    ok: true,
    db: {
      ...db,
      assignments: db.assignments.map((item) =>
        item.id === assignment.id
          ? { ...item, status: "cancelled", updatedAt: now }
          : item,
      ),
      auditEvents: [
        ...db.auditEvents,
        audit(
          session,
          "shift.unassign",
          "shift_assignment",
          assignment.id,
          "Removed a worker from a shift.",
        ),
      ],
    },
  };
}

export function updatePreferences(
  db: DemoDatabase,
  input: { displayName: string; emailAlerts: boolean; showVoiceTextFirst: boolean },
): OperationResult {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  if (input.displayName.trim().length < 2) {
    return fail("VALIDATION", "Enter your name.", { displayName: "Enter your name." });
  }
  const session = db.session;
  const now = new Date().toISOString();
  const nextSession: Session = { ...session, displayName: input.displayName.trim() };
  return {
    ok: true,
    db: {
      ...db,
      session: nextSession,
      users: db.users.map((user) =>
        user.id === session.userId
          ? { ...user, displayName: input.displayName.trim(), updatedAt: now }
          : user,
      ),
      preferences: {
        ...db.preferences,
        [session.userId]: {
          emailAlerts: input.emailAlerts,
          showVoiceTextFirst: input.showVoiceTextFirst,
        },
      },
    },
  };
}

export function previewRole(
  db: DemoDatabase,
  role: MembershipRole,
  workerAccessType?: WorkerAccessType,
): OperationResult {
  if (!db.session) return fail("FORBIDDEN", "Sign in is required.");
  const target = db.memberships.find(
    (membership) =>
      membership.organisationId === db.session?.organisationId &&
      membership.role === role &&
      membershipAllowsLogin(membership) &&
      membership.userId !== db.session.userId &&
      (role !== "worker" ||
        !workerAccessType ||
        workerAccessTypeOf(membership) === workerAccessType),
  );
  if (!target) {
    return fail(
      "NOT_FOUND",
      "This organisation has no other demo account for that role.",
    );
  }
  const user = db.users.find((item) => item.id === target.userId);
  if (!user) return fail("NOT_FOUND", "That demo account is missing.");
  const session = sessionFromMembership(user, target);
  return { ok: true, db: { ...db, session, selectedMachineId: null } };
}

export function previewAccount(
  db: DemoDatabase,
  email: string,
): OperationResult<{ session: Session }> {
  return loginAsEmail(db, email);
}

export function machineMemoriesForAnswer(
  db: DemoDatabase,
  organisationId: string,
  machineId: string,
) {
  return memoriesForMachine(db, organisationId, machineId);
}

export function assertMachineCodeAvailable(
  db: DemoDatabase,
  organisationId: string,
  code: string,
) {
  return machineByCode(db, organisationId, code) === null;
}
