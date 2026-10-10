import type { AuthProviderKind, DemoCredential, DemoDatabase, User } from "@/types/domain";

/** Normalize older fixtures that only had `authProvider`. */
export function authProvidersOf(user: User): AuthProviderKind[] {
  if (user.authProviders?.length) return user.authProviders;
  if (user.authProvider === "oauth") return ["google"];
  return ["password"];
}

export function withAuthProvider(user: User, provider: AuthProviderKind): User {
  const current = authProvidersOf(user);
  if (current.includes(provider)) {
    return { ...user, authProviders: current };
  }
  return {
    ...user,
    authProviders: [...current, provider],
    updatedAt: new Date().toISOString(),
  };
}

export function credentialsOf(db: DemoDatabase): Record<string, DemoCredential> {
  return db.credentials ?? {};
}

export function verifyPassword(
  db: DemoDatabase,
  userId: string,
  secret: string,
): boolean {
  const credential = credentialsOf(db)[userId];
  return Boolean(credential && credential.secret === secret);
}

export function setCredential(
  db: DemoDatabase,
  userId: string,
  secret: string,
  temporary: boolean,
): DemoDatabase {
  return {
    ...db,
    credentials: {
      ...credentialsOf(db),
      [userId]: { secret, temporary },
    },
  };
}
