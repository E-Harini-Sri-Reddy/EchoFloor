import { createSeed } from "@/fixtures/seed";
import {
  acknowledgeAlert,
  acknowledgeHandover,
  assignWorkerToShift,
  createMachine,
  createReport,
  createTask,
  reportMachineIssue,
  generateHandover,
  inviteWorker,
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
  type InviteWorkerInput,
  type MachineInput,
  type ReportInput,
  type ReportMachineIssueInput,
  type UpdateShiftPolicyInput,
} from "@/domain/operations";
import type {
  DemoDatabase,
  EditableMemory,
  FieldChange,
  MembershipRole,
  TaskStatus,
  WorkerAccessType,
} from "@/types/domain";

const STORAGE_KEY = "echofloor.demo.v6";

let database = readInitial();
const listeners = new Set<() => void>();

function readInitial(): DemoDatabase {
  if (typeof sessionStorage === "undefined") {
    return createSeed();
  }
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeed();
    const parsed = JSON.parse(raw) as DemoDatabase;
    if (
      !parsed ||
      !Array.isArray(parsed.organisations) ||
      !Array.isArray(parsed.memories)
    ) {
      return createSeed();
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
    return createSeed();
  }
}

function commit(next: DemoDatabase) {
  database = next;
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  }
  listeners.forEach((listener) => listener());
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
  }
  commit(createSeed());
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
  logout: () => commit(logout(database)),
  reset: resetDemoDatabase,
  setForceLoadError: (value: boolean) => commit(setForceLoadError(database, value)),
  selectMachine: (machineId: string | null) => apply(selectMachine(database, machineId)),
  createMachine: (input: MachineInput) => apply(createMachine(database, input)),
  updateMachine: (machineId: string, input: MachineInput) =>
    apply(updateMachine(database, machineId, input)),
  updateOrganisation: (input: { name: string; timezone: string }) =>
    apply(updateOrganisationSettings(database, input)),
  inviteWorker: (input: InviteWorkerInput) => apply(inviteWorker(database, input)),
  setPermanentWorkerSuspension: (membershipId: string, suspended: boolean) =>
    apply(setPermanentWorkerSuspension(database, membershipId, suspended)),
  updateWorkerAccessWindow: (
    membershipId: string,
    input: {
      workerAccessType: WorkerAccessType;
      accessDuration: InviteWorkerInput["accessDuration"];
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
  generateHandover: () => apply(generateHandover(database)),
  publishHandover: (handoverId: string) => apply(publishHandover(database, handoverId)),
  acknowledgeHandover: (handoverId: string) =>
    apply(acknowledgeHandover(database, handoverId)),
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
