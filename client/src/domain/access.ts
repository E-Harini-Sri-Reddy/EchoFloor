import type {
  Membership,
  MemoryRecord,
  MemoryType,
  Session,
  WorkerAccessDuration,
  WorkerAccessType,
} from "@/types/domain";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Memory types treated as damage / repair history for temporary workers. */
export const DAMAGE_REPAIR_TYPES: readonly MemoryType[] = [
  "incident",
  "troubleshooting",
  "maintenance",
];

/** Memory types treated as daily work / usage logs (summary-only for temporary workers). */
export const DAILY_WORK_LOG_TYPES: readonly MemoryType[] = [
  "observation",
  "operational_note",
  "handover_note",
];

export function isDamageOrRepairMemory(memory: MemoryRecord): boolean {
  return DAMAGE_REPAIR_TYPES.includes(memory.type);
}

export function isDailyWorkLogMemory(memory: MemoryRecord): boolean {
  return DAILY_WORK_LOG_TYPES.includes(memory.type);
}

export function workerAccessTypeOf(
  membership: Membership | null | undefined,
): WorkerAccessType | null {
  if (!membership || membership.role !== "worker") return null;
  return membership.workerAccessType ?? "permanent";
}

export function isTemporaryWorker(session: Session | null | undefined): boolean {
  return session?.role === "worker" && session.workerAccessType === "temporary";
}

export function isPermanentWorker(session: Session | null | undefined): boolean {
  return session?.role === "worker" && session.workerAccessType !== "temporary";
}

export function resolveAccessExpiry(
  workerAccessType: WorkerAccessType,
  duration: WorkerAccessDuration,
  customExpiresAt: string | undefined,
  now: Date = new Date(),
): { ok: true; accessExpiresAt: string | null } | { ok: false; message: string } {
  if (workerAccessType === "permanent") {
    if (duration !== "until_removed") {
      return {
        ok: false,
        message: "Permanent workers stay active until manual removal or suspension.",
      };
    }
    return { ok: true, accessExpiresAt: null };
  }

  if (duration === "until_removed") {
    return {
      ok: false,
      message: "Choose how long temporary access should last.",
    };
  }

  if (duration === "custom") {
    const raw = customExpiresAt?.trim() ?? "";
    if (!raw) {
      return { ok: false, message: "Choose a custom end date and time." };
    }
    const expires = new Date(raw);
    if (Number.isNaN(expires.getTime())) {
      return { ok: false, message: "Enter a valid custom end date and time." };
    }
    if (expires.getTime() <= now.getTime()) {
      return { ok: false, message: "The custom end must be in the future." };
    }
    return { ok: true, accessExpiresAt: expires.toISOString() };
  }

  const offsets: Record<"24h" | "1w" | "1m", number> = {
    "24h": DAY_MS,
    "1w": 7 * DAY_MS,
    "1m": 30 * DAY_MS,
  };
  return {
    ok: true,
    accessExpiresAt: new Date(now.getTime() + offsets[duration]).toISOString(),
  };
}

export type MembershipAccessState =
  | "active"
  | "suspended"
  | "expired"
  | "removed"
  | "inactive_user";

export function membershipAccessState(
  membership: Membership,
  now: Date = new Date(),
): MembershipAccessState {
  if (membership.status === "removed") return "removed";
  if (membership.status === "suspended") return "suspended";
  if (
    membership.role === "worker" &&
    membership.workerAccessType === "temporary" &&
    membership.accessExpiresAt &&
    new Date(membership.accessExpiresAt).getTime() <= now.getTime()
  ) {
    return "expired";
  }
  if (membership.status === "active") return "active";
  return "removed";
}

export function membershipAllowsLogin(
  membership: Membership,
  now: Date = new Date(),
): boolean {
  return membershipAccessState(membership, now) === "active";
}

export function loginBlockedMessage(
  state: MembershipAccessState,
): string | null {
  switch (state) {
    case "suspended":
      return "This permanent worker account is suspended. An administrator must restore access.";
    case "expired":
      return "This temporary worker login has expired. Ask an administrator for a new access window.";
    case "removed":
      return "This membership is no longer active.";
    case "inactive_user":
      return "This account is disabled.";
    case "active":
      return null;
  }
}

export function homePathForSession(session: Session): string {
  if (session.role === "admin") return "/admin";
  return "/worker/voice";
}

export function temporaryWorkerMayOpen(pathname: string): boolean {
  if (!pathname.startsWith("/worker")) return false;
  const allowed = [
    "/worker/voice",
    "/worker/dashboard",
    "/worker/work-log",
    "/worker/issues",
    "/worker/report-issue",
    "/worker/alerts",
    "/worker/history",
    "/worker/tasks",
    "/worker/settings",
  ];
  if (pathname === "/worker" || pathname === "/worker/") return true;
  return allowed.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
