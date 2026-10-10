/**
 * Client DTOs aligned with docs/05-MongoDB-Data-Model-Schema-and-Indexes.md.
 * Identifiers are strings at the UI boundary. The API will map MongoDB ObjectIds later.
 *
 * Role naming: Document 01 calls the administrator role `org_admin`.
 * The membership schema and coding guidelines use `admin`. This mockup follows
 * the membership schema (`admin` | `worker`) and displays it as Administrator.
 *
 * Worker access kinds (product extension for this mockup):
 * - permanent: until manual removal; may be suspended by an administrator.
 * - temporary: time-bounded login; cannot be suspended (access ends at expiry).
 * Temporary workers may use Voice Assistant, AI work-log summaries, and
 * damage/repair history detail. They cannot open detailed daily work logs.
 */

export type MembershipRole = "admin" | "worker";
export type WorkerAccessType = "permanent" | "temporary";
export type WorkerAccessDuration =
  | "until_removed"
  | "24h"
  | "1w"
  | "1m"
  | "custom";

export type OrganisationStatus = "active" | "suspended";
export type UserStatus = "active" | "disabled";
export type MembershipStatus = "active" | "suspended" | "removed";
export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";
export type MachineStatus = "active" | "maintenance" | "inactive";
export type MemoryType =
  | "incident"
  | "troubleshooting"
  | "maintenance"
  | "observation"
  | "operational_note"
  | "handover_note";
export type MemoryStatus =
  "pending_review" | "verified" | "unresolved" | "resolved" | "superseded" | "archived";
export type MemorySourceType = "voice" | "text" | "admin_edit" | "import";
export type ConstraintStatus = "active" | "expired" | "revoked";
export type Severity = "info" | "warning" | "critical";
export type ShiftStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type AssignmentStatus = "assigned" | "accepted" | "completed" | "cancelled";
export type ShiftKind = "morning" | "afternoon" | "night";
export type ShiftRotation = "weekly" | "fortnightly";

export interface ShiftTemplate {
  kind: ShiftKind;
  label: string;
  /** Local wall-clock start as HH:mm in the organisation timezone. */
  startLocal: string;
  durationMinutes: number;
}

export interface OrganisationShiftPolicy {
  templates: ShiftTemplate[];
  rotation: ShiftRotation;
  /** Minimum rest required between the end of one assigned shift and the start of the next. */
  minRestHoursBetweenShifts: number;
  /** How many days must pass before shift start times or durations may be changed again. */
  timingChangeCooldownDays: number;
  lastTimingChangedAt: string | null;
}
export type HandoverStatus = "draft" | "published" | "acknowledged" | "archived";
export type AlertType =
  | "new_report"
  | "constraint_expiring"
  | "constraint_expired"
  | "handover_pending"
  | "workflow_failure"
  | "admin_notice"
  | "machine_breakdown"
  | "machine_damage"
  | "machine_maintenance"
  | "machine_hazard";
export type AlertStatus = "open" | "acknowledged" | "resolved" | "dismissed";
export type AlertSourceType =
  | "memory"
  | "constraint"
  | "handover"
  | "workflow"
  | "system"
  | "issue_report";
/** Categories that appear in Live Alerts while active. */
export type MachineIssueKind =
  | "breakdown"
  | "damage"
  | "maintenance"
  | "overheating"
  | "unsafe";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "completed" | "cancelled";

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  status: OrganisationStatus;
  settings: {
    timezone: string;
    defaultShiftDurationMinutes?: number;
    shiftPolicy?: OrganisationShiftPolicy;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AuthProviderKind = "password" | "google";

export interface User {
  id: string;
  email: string;
  emailNormalized: string;
  displayName: string;
  /**
   * Sign-in methods linked to this same user id.
   * Password and Google must resolve to one membership/session when the email matches.
   */
  authProviders: AuthProviderKind[];
  /** @deprecated Prefer authProviders. Kept for older session fixtures. */
  authProvider?: "local" | "oauth";
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

/** Session-only credential map. Never named `password` on the User record. */
export interface DemoCredential {
  secret: string;
  temporary: boolean;
}

export interface Membership {
  id: string;
  organisationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  /**
   * Set for worker memberships. Administrators have no worker access kind.
   * Older session fixtures without this field are treated as permanent.
   */
  workerAccessType?: WorkerAccessType;
  /**
   * When set for a temporary worker, login is refused at or after this instant.
   * Permanent workers keep null / undefined until manual removal.
   */
  accessExpiresAt?: string | null;
  accessDurationPreset?: WorkerAccessDuration;
  joinedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invitation {
  id: string;
  organisationId: string;
  emailNormalized: string;
  role: "worker";
  workerAccessType: WorkerAccessType;
  /** Invitation token expiry (when the invite can still be accepted). */
  expiresAt: string;
  /** Login window granted after acceptance for temporary workers. */
  accessExpiresAt?: string | null;
  accessDurationPreset: WorkerAccessDuration;
  status: InvitationStatus;
  invitedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MachineLocation {
  site?: string;
  building?: string;
  productionLine?: string;
  area?: string;
}

export interface Machine {
  id: string;
  organisationId: string;
  machineCode: string;
  name: string;
  description?: string;
  location: MachineLocation;
  machineType?: string;
  status: MachineStatus;
  nfc: {
    tagId: string | null;
    enabled: boolean;
    registeredAt?: string;
  };
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryRecord {
  id: string;
  organisationId: string;
  machineId: string;
  type: MemoryType;
  title: string;
  content: string;
  summary?: string;
  status: MemoryStatus;
  source: {
    type: MemorySourceType;
    submittedBy?: string;
  };
  tags: string[];
  machineContext?: {
    errorCode?: string;
    component?: string;
    operatingConditions?: string[];
  };
  resolution?: {
    description: string;
    resolvedBy: string;
    resolvedAt: string;
  };
  currentRevision: number;
  /** Example records are historical demonstration knowledge, not live telemetry. */
  example: boolean;
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
}

export interface MemoryRevision {
  id: string;
  organisationId: string;
  memoryId: string;
  revisionNumber: number;
  snapshot: {
    type: MemoryType;
    title: string;
    content: string;
    summary?: string;
    status: MemoryStatus;
    tags: string[];
  };
  changeSummary: string;
  changedBy: string;
  createdAt: string;
}

export interface Constraint {
  id: string;
  organisationId: string;
  machineId: string;
  title: string;
  description: string;
  status: ConstraintStatus;
  severity: Severity;
  effectiveAt: string;
  expiresAt?: string;
  sourceMemoryId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Shift {
  id: string;
  organisationId: string;
  name: string;
  kind: ShiftKind;
  startAt: string;
  endAt: string;
  status: ShiftStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShiftAssignment {
  id: string;
  organisationId: string;
  shiftId: string;
  userId: string;
  machineIds: string[];
  status: AssignmentStatus;
  assignedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Handover {
  id: string;
  organisationId: string;
  machineIds: string[];
  fromShiftId?: string;
  toShiftId?: string;
  createdBy: string;
  title: string;
  /** Generated summary. Distinct from quoted operator reports. */
  summary: string;
  summaryKind: "generated" | "operator";
  memoryIds: string[];
  constraintIds: string[];
  status: HandoverStatus;
  publishedAt?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  organisationId: string;
  machineId?: string;
  type: AlertType;
  severity: Severity;
  title: string;
  message: string;
  status: AlertStatus;
  sourceType: AlertSourceType;
  sourceId?: string;
  targetUserIds?: string[];
  /**
   * When set, the alert leaves Live Alerts at this instant.
   * Informational machine notices may omit this field.
   */
  expiresAt?: string;
  /** Browser-session photo (data URL). Not uploaded to a server in this mockup. */
  photoDataUrl?: string;
  photoName?: string;
  issueKind?: MachineIssueKind;
  reportedBy?: string;
  createdAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

/** Administrator-assigned work item for a worker. Session fixture only in this mockup. */
export interface Task {
  id: string;
  organisationId: string;
  assigneeUserId: string;
  assignedBy: string;
  machineId?: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueAt?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface AuditEvent {
  id: string;
  organisationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
  createdAt: string;
}

export interface UserPreferences {
  emailAlerts: boolean;
  showVoiceTextFirst: boolean;
}

export interface Session {
  userId: string;
  organisationId: string;
  role: MembershipRole;
  /** Present for workers. Administrators leave this null. */
  workerAccessType: WorkerAccessType | null;
  accessExpiresAt: string | null;
  displayName: string;
  email: string;
  /** Development-only session. This is not a server authentication token. */
  demo: true;
}

export interface DemoFlags {
  forceLoadError: boolean;
}

export interface DemoDatabase {
  organisations: Organisation[];
  users: User[];
  memberships: Membership[];
  invitations: Invitation[];
  machines: Machine[];
  memories: MemoryRecord[];
  revisions: MemoryRevision[];
  constraints: Constraint[];
  shifts: Shift[];
  assignments: ShiftAssignment[];
  handovers: Handover[];
  alerts: Alert[];
  tasks: Task[];
  auditEvents: AuditEvent[];
  preferences: Record<string, UserPreferences>;
  /** Keyed by user id. Browser-session mock secrets only. */
  credentials: Record<string, DemoCredential>;
  session: Session | null;
  flags: DemoFlags;
  selectedMachineId: string | null;
}

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

export interface EditableMemory {
  title: string;
  content: string;
  summary: string;
  status: MemoryStatus;
  type: MemoryType;
  tags: string;
  component: string;
  operatingConditions: string;
}
