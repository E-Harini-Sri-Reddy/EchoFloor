import { OAuth2Client } from "google-auth-library";

export interface GoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "INVALID_TOKEN" | "EMAIL_UNVERIFIED",
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export async function verifyGoogleIdToken(
  clientId: string | null,
  idToken: string,
): Promise<GoogleIdentity> {
  if (!clientId) {
    throw new GoogleAuthError(
      "Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.",
      "UNAVAILABLE",
    );
  }

  const token = idToken.trim();
  if (!token) {
    throw new GoogleAuthError("A Google ID token is required.", "INVALID_TOKEN");
  }

  const client = new OAuth2Client(clientId);
  let ticket;
  try {
    ticket = await client.verifyIdToken({
      idToken: token,
      audience: clientId,
    });
  } catch {
    throw new GoogleAuthError(
      "The Google ID token could not be verified.",
      "INVALID_TOKEN",
    );
  }

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) {
    throw new GoogleAuthError(
      "The Google account did not return a usable email address.",
      "INVALID_TOKEN",
    );
  }
  if (payload.email_verified !== true) {
    throw new GoogleAuthError(
      "That Google account email is not verified.",
      "EMAIL_UNVERIFIED",
    );
  }

  return {
    sub: payload.sub,
    email: payload.email.trim().toLowerCase(),
    emailVerified: true,
    name: payload.name?.trim() || null,
    picture: payload.picture ?? null,
  };
}
