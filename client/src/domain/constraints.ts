import type { Constraint } from "@/types/domain";

export function isConstraintActive(constraint: Constraint, now: Date): boolean {
  if (constraint.status !== "active") {
    return false;
  }
  const effectiveAt = new Date(constraint.effectiveAt).getTime();
  if (Number.isNaN(effectiveAt) || effectiveAt > now.getTime()) {
    return false;
  }
  if (!constraint.expiresAt) {
    return true;
  }
  const expiresAt = new Date(constraint.expiresAt).getTime();
  return !Number.isNaN(expiresAt) && expiresAt > now.getTime();
}

export function constraintDisplayStatus(
  constraint: Constraint,
  now: Date,
): "Active" | "Expired" | "Revoked" | "Scheduled" {
  if (constraint.status === "revoked") {
    return "Revoked";
  }
  const effectiveAt = new Date(constraint.effectiveAt).getTime();
  if (constraint.status === "active" && effectiveAt > now.getTime()) {
    return "Scheduled";
  }
  if (isConstraintActive(constraint, now)) {
    return "Active";
  }
  return "Expired";
}
