import { createSeed } from "@/fixtures/seed";
import {
  acceptShiftAssignment,
  acknowledgeAlert,
  acknowledgeHandover,
  assignWorkerToShift,
  createMachine,
  createReport,
  createTask,
  reportMachineIssue,
  generateHandover,
  addMember,
  leaveOrganisation,
  removeMember,
  loginAsEmail,
  loginWithGoogle,
  loginWithPassword,
  logout,
  previewRole,
  publishHandover,
  registerOrganisation,
  registerOrganisationWithGoogle,
  removeShiftAssignment,
  resolveAlert,
  resolveOverheatingByVoice,
  reviewIssuePhotoAi,
  selectMachine,
  setForceLoadError,
  setPermanentWorkerSuspension,
  updateMachine,
  updateMemory,
  updateOrganisationSettings,
  updatePreferences,
  updateShiftPolicy,
  updateTaskStatus,
  updateWorkerAccessWindow,
  type AssignWorkerToShiftInput,
  type CreateTaskInput,
  type AddMemberInput,
  type MachineInput,
  type ReportInput,
  type ReportMachineIssueInput,
  type UpdateShiftPolicyInput,
} from "@/domain/operations";
import { getClientConfig } from "@/services/clientConfig";
import type {
  DemoDatabase,
  EditableMemory,
  FieldChange,
  MembershipRole,
  Session,
  TaskStatus,
  WorkerAccessType,
} from "@/types/domain";

const STORAGE_KEY = "echofloor.demo.v6";
const LIVE_SESSION_KEY = "echofloor.live.session";

let database = readInitial();
const listeners = new Set<() => void>();

export function emptyLiveShell(): DemoDatabase {
  return {
    organisations: [],
    users: [],
    memberships: [],
    invitations: [],
    machines: [],
    memories: [],
    revisions: [],
    constraints: [],
    shifts: [],
    assignments: [],
    handovers: [],
    alerts: [],
    tasks: [],
    auditEvents: [],
    preferences: {},
    credentials: {},
    session: null,
    flags: { forceLoadError: false },
    selectedMachineId: null,
  };
}

function readInitial(): DemoDatabase {
  const liveMode =
    typeof import.meta !== "undefined" && getClientConfig().dataSource === "api";
  if (typeof sessionStorage === "undefined") {
    return liveMode ? emptyLiveShell() : createSeed();
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return liveMode ? emptyLiveShell() : createSeed();
    const parsed = JSON.parse(raw) as DemoDatabase;
    if (
      !parsed ||
      !Array.isArray(parsed.organisations) ||
      !Array.isArray(parsed.memories)
    ) {
      return liveMode ? emptyLiveShell() : createSeed();
    }
    if (liveMode) {
      // Fixture sessions must not masquerade as Mongo-backed org data.
      if (!parsed.session?.live) {
        return emptyLiveShell();
      }
      return parsed;
    }
    const seed = createSeed();
    if (!Array.isArray(parsed.tasks)) {
      parsed.tasks = seed.tasks;
    }
    if (!parsed.credentials || typeof parsed.credentials !== "object") {
      parsed.credentials = seed.credentials;
    }
    parsed.users = parsed.users.map((user) => ({
      ...user,
      authProviders:
        user.authProviders?.length > 0
          ? user.authProviders
          : user.authProvider === "oauth"
            ? ["google"]
            : ["password"],
    }));
    return parsed;
  } catch {
    return liveMode ? emptyLiveShell() : createSeed();
  }
}

function commit(next: DemoDatabase) {
  database = next;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(database));
    if (next.session?.live) {
      sessionStorage.setItem(
        LIVE_SESSION_KEY,
        JSON.stringify({
          userId: next.session.userId,
          organisationId: next.session.organisationId,
        }),
      );
    } else if (!next.session) {
      sessionStorage.removeItem(LIVE_SESSION_KEY);
    }
  }
  listeners.forEach((listener) => listener());
}

export function isLiveDataMode() {
  return getClientConfig().dataSource === "api";
}

export function hydrateFromWorkspace(workspace: DemoDatabase, session: Session) {
  commit({
    ...workspace,
    session: { ...session, demo: false, live: true },
    flags: { forceLoadError: false },
  });
}

export function getDatabase(): DemoDatabase {
  return database;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetDemoDatabase() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LIVE_SESSION_KEY);
  }
  commit(isLiveDataMode() ? emptyLiveShell() : createSeed());
}

function apply<T extends { ok: true; db: DemoDatabase } | { ok: false }>(result: T): T {
  if (result.ok) {
    commit(result.db);
  }
  return result;
}

export const demoStore = {
  register: (input: {
    organisationName: string;
    displayName: string;
    email: string;
    password: string;
  }) => apply(registerOrganisation(database, input)),
  registerWithGoogle: (input: {
    organisationName: string;
    displayName: string;
    email: string;
  }) => apply(registerOrganisationWithGoogle(database, input)),
  /** Preview entry without password (demo account buttons). */
  login: (email: string) => apply(loginAsEmail(database, email)),
  loginWithPassword: (email: string, password: string) =>
    apply(loginWithPassword(database, email, password)),
  loginWithGoogle: (email: string) => apply(loginWithGoogle(database, email)),
  logout: () => {
    if (isLiveDataMode()) {
      commit(emptyLiveShell());
      return;
    }
    commit(logout(database));
  },
  reset: resetDemoDatabase,
  setForceLoadError: (value: boolean) => commit(setForceLoadError(database, value)),
  selectMachine: (machineId: string | null) => apply(selectMachine(database, machineId)),
  createMachine: (input: MachineInput) => apply(createMachine(database, input)),
  /** Replace local store with a MongoDB workspace snapshot. */
  hydrateLive: (workspace: DemoDatabase, session: Session) =>
    hydrateFromWorkspace(workspace, session),
  updateMachine: (machineId: string, input: MachineInput) =>
    apply(updateMachine(database, machineId, input)),
  updateOrganisation: (input: { name: string; timezone: string }) =>
    apply(updateOrganisationSettings(database, input)),
  addMember: (input: AddMemberInput) => apply(addMember(database, input)),
  leaveOrganisation: () => apply(leaveOrganisation(database)),
  removeMember: (membershipId: string) =>
    apply(removeMember(database, membershipId)),
  setPermanentWorkerSuspension: (membershipId: string, suspended: boolean) =>
    apply(setPermanentWorkerSuspension(database, membershipId, suspended)),
  updateWorkerAccessWindow: (
    membershipId: string,
    input: {
      workerAccessType: WorkerAccessType;
      accessDuration: AddMemberInput["accessDuration"];
      customExpiresAt?: string;
    },
  ) => apply(updateWorkerAccessWindow(database, membershipId, input)),
  updateMemory: (
    memoryId: string,
    draft: EditableMemory,
    expectedRevision: number,
    changes: FieldChange[],
  ) => apply(updateMemory(database, memoryId, draft, expectedRevision, changes)),
  createReport: (input: ReportInput) => apply(createReport(database, input)),
  reportMachineIssue: (input: ReportMachineIssueInput) =>
    apply(reportMachineIssue(database, input)),
  createTask: (input: CreateTaskInput) => apply(createTask(database, input)),
  updateTaskStatus: (taskId: string, status: TaskStatus) =>
    apply(updateTaskStatus(database, taskId, status)),
  acknowledgeAlert: (alertId: string) => apply(acknowledgeAlert(database, alertId)),
  resolveAlert: (alertId: string) => apply(resolveAlert(database, alertId)),
  resolveOverheatingByVoice: (machineId: string) =>
    apply(resolveOverheatingByVoice(database, machineId)),
  reviewIssuePhotoAi: (alertId: string, decision: "cleared" | "flagged_false") =>
    apply(reviewIssuePhotoAi(database, alertId, decision)),
  generateHandover: () => apply(generateHandover(database)),
  publishHandover: (handoverId: string) => apply(publishHandover(database, handoverId)),
  acknowledgeHandover: (handoverId: string) =>
    apply(acknowledgeHandover(database, handoverId)),
  acceptShiftAssignment: (assignmentId: string) =>
    apply(acceptShiftAssignment(database, assignmentId)),
  updateShiftPolicy: (input: UpdateShiftPolicyInput) =>
    apply(updateShiftPolicy(database, input)),
  assignWorkerToShift: (input: AssignWorkerToShiftInput) =>
    apply(assignWorkerToShift(database, input)),
  removeShiftAssignment: (assignmentId: string) =>
    apply(removeShiftAssignment(database, assignmentId)),
  updatePreferences: (input: {
    displayName: string;
    emailAlerts: boolean;
    showVoiceTextFirst: boolean;
  }) => apply(updatePreferences(database, input)),
  previewRole: (role: MembershipRole, workerAccessType?: WorkerAccessType) =>
    apply(previewRole(database, role, workerAccessType)),
};
