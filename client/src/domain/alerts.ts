import type { Alert, AlertType, MachineIssueKind, Severity } from "@/types/domain";

/** Alert types that belong in Live Alerts while open and unexpired. */
export const LIVE_ALERT_TYPES: readonly AlertType[] = [
  "machine_breakdown",
  "machine_damage",
  "machine_maintenance",
  "machine_hazard",
  "constraint_expiring",
  "constraint_expired",
  "workflow_failure",
];

export function alertTypeForIssue(kind: MachineIssueKind): AlertType {
  switch (kind) {
    case "breakdown":
      return "machine_breakdown";
    case "damage":
      return "machine_damage";
    case "maintenance":
      return "machine_maintenance";
    case "overheating":
    case "unsafe":
      return "machine_hazard";
  }
}

export function severityForIssue(kind: MachineIssueKind): Severity {
  switch (kind) {
    case "maintenance":
      return "warning";
    case "breakdown":
    case "damage":
    case "overheating":
    case "unsafe":
      return "critical";
  }
}

export function labelMachineIssueKind(kind: MachineIssueKind): string {
  switch (kind) {
    case "breakdown":
      return "Breakdown / not functioning";
    case "damage":
      return "Damage";
    case "maintenance":
      return "Maintenance — do not operate";
    case "overheating":
      return "Overheating";
    case "unsafe":
      return "Unsafe to use";
  }
}

export function isAlertExpired(alert: Alert, now: Date = new Date()): boolean {
  if (!alert.expiresAt) return false;
  const expires = new Date(alert.expiresAt).getTime();
  if (Number.isNaN(expires)) return false;
  return expires <= now.getTime();
}

/**
 * Live Alerts feed: operational warnings/criticals that are still in force.
 * Informational notices are excluded and belong on machine info instead.
 */
export function isLiveOperationalAlert(alert: Alert, now: Date = new Date()): boolean {
  if (alert.severity === "info") return false;
  if (alert.status === "resolved" || alert.status === "dismissed") return false;
  if (isAlertExpired(alert, now)) return false;
  if (LIVE_ALERT_TYPES.includes(alert.type)) return true;
  // Legacy warning/critical fixture types that are still operational.
  return (
    (alert.severity === "warning" || alert.severity === "critical") &&
    alert.type !== "admin_notice" &&
    alert.type !== "handover_pending" &&
    alert.type !== "new_report"
  );
}

/** Informational items shown under machine information, not Live Alerts. */
export function isMachineInfoNotice(alert: Alert, now: Date = new Date()): boolean {
  if (isLiveOperationalAlert(alert, now)) return false;
  if (alert.status === "dismissed") return false;
  if (isAlertExpired(alert, now)) return false;
  return (
    alert.severity === "info" ||
    alert.type === "admin_notice" ||
    alert.type === "handover_pending" ||
    alert.type === "new_report"
  );
}

export function issueDurationPresets(): Array<{
  id: string;
  label: string;
  hours: number;
}> {
  return [
    { id: "2h", label: "2 hours", hours: 2 },
    { id: "8h", label: "8 hours", hours: 8 },
    { id: "1d", label: "1 day", hours: 24 },
    { id: "2d", label: "2 days", hours: 48 },
    { id: "custom", label: "Custom end", hours: 0 },
  ];
}

export const MAX_ISSUE_PHOTO_BYTES = 1_500_000;
