import { workerAccessTypeOf } from "@/domain/access";
import type { Membership, Session, User } from "@/types/domain";

export function sessionFromMembership(user: User, membership: Membership): Session {
  const workerAccessType =
    membership.role === "worker" ? workerAccessTypeOf(membership) : null;
  return {
    userId: user.id,
    organisationId: membership.organisationId,
    role: membership.role,
    workerAccessType,
    accessExpiresAt:
      membership.role === "worker" ? (membership.accessExpiresAt ?? null) : null,
    displayName: user.displayName,
    email: user.email,
    demo: true,
  };
}
