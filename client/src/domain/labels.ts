import type {
  AlertStatus,
  AlertType,
  HandoverStatus,
  MachineStatus,
  MembershipRole,
  MemoryStatus,
  MemoryType,
  Session,
  Severity,
  TaskPriority,
  TaskStatus,
  WorkerAccessDuration,
  WorkerAccessType,
} from "@/types/domain";

export function labelMemoryStatus(status: MemoryStatus): string {
  switch (status) {
    case "pending_review":
      return "Pending review";
    case "verified":
      return "Verified";
    case "unresolved":
      return "Unresolved";
    case "resolved":
      return "Resolved";
    case "superseded":
      return "Superseded";
    case "archived":
      return "Archived";
  }
}

export function labelMemoryType(type: MemoryType): string {
  return type.replaceAll("_", " ");
}

export function labelMachineStatus(status: MachineStatus): string {
  switch (status) {
    case "active":
      return "Active record";
    case "maintenance":
      return "Maintenance record";
    case "inactive":
      return "Inactive";
  }
}

export function labelSeverity(severity: Severity): string {
  switch (severity) {
    case "info":
      return "Informational";
    case "warning":
      return "Warning";
    case "critical":
      return "Critical";
  }
}

export function labelAlertStatus(status: AlertStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "acknowledged":
      return "Acknowledged";
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
  }
}

export function labelIssuePhotoAiReview(
  status: "queued" | "needs_admin_review" | "cleared" | "flagged_false",
): string {
  switch (status) {
    case "queued":
      return "AI screening queued";
    case "needs_admin_review":
      return "Admin review requested";
    case "cleared":
      return "Photo cleared";
    case "flagged_false":
      return "Suspected false report";
  }
}

export function labelAlertType(type: AlertType): string {
  switch (type) {
    case "machine_breakdown":
      return "Breakdown";
    case "machine_damage":
      return "Damage";
    case "machine_maintenance":
      return "Maintenance hold";
    case "machine_hazard":
      return "Hazard / unsafe";
    default:
      return type.replaceAll("_", " ");
  }
}

export function labelHandoverStatus(status: HandoverStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "published":
      return "Published";
    case "acknowledged":
      return "Acknowledged";
    case "archived":
      return "Archived";
  }
}

export function labelRole(role: MembershipRole): string {
  return role === "admin" ? "Administrator" : "Worker";
}

export function labelWorkerAccessType(type: WorkerAccessType | null | undefined): string {
  if (type === "temporary") return "Temporary worker";
  if (type === "permanent") return "Permanent worker";
  return "Worker";
}

export function labelSessionRole(session: Session): string {
  if (session.role === "admin") return "Administrator";
  return labelWorkerAccessType(session.workerAccessType ?? "permanent");
}

export function labelAccessDuration(duration: WorkerAccessDuration): string {
  switch (duration) {
    case "until_removed":
      return "Until manual removal";
    case "24h":
      return "24 hours";
    case "1w":
      return "1 week";
    case "1m":
      return "1 month";
    case "custom":
      return "Custom range";
  }
}

export function labelTaskPriority(priority: TaskPriority): string {
  switch (priority) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "urgent":
      return "Urgent";
  }
}

export function labelTaskStatus(status: TaskStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
  }
}

export function taskPriorityTone(
  priority: TaskPriority,
): "success" | "warning" | "danger" | "info" | "neutral" {
  switch (priority) {
    case "low":
      return "neutral";
    case "medium":
      return "info";
    case "high":
      return "warning";
    case "urgent":
      return "danger";
  }
}

export function statusTone(
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (
    status === "verified" ||
    status === "resolved" ||
    status === "completed" ||
    status === "active" ||
    status === "Active" ||
    status === "success"
  ) {
    return "success";
  }
  if (
    status === "pending_review" ||
    status === "unresolved" ||
    status === "warning" ||
    status === "high" ||
    status === "in_progress" ||
    status === "Expired" ||
    status === "expiring"
  ) {
    return "warning";
  }
  if (
    status === "critical" ||
    status === "inactive" ||
    status === "Revoked" ||
    status === "urgent" ||
    status === "danger" ||
    status === "cancelled"
  ) {
    return "danger";
  }
  if (
    status === "info" ||
    status === "medium" ||
    status === "acknowledged" ||
    status === "published" ||
    status === "superseded" ||
    status === "open"
  ) {
    return "info";
  }
  return "neutral";
}
