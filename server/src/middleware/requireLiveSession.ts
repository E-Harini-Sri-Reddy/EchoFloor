import type { Request, Response, NextFunction } from "express";
import { getDb } from "../db/mongo.js";
import { asObjectId, toId } from "../db/workspace.js";

export interface LiveSession {
  userId: string;
  organisationId: string;
  role: "admin" | "worker";
}

declare module "express-serve-static-core" {
  interface Request {
    liveSession?: LiveSession;
  }
}

function readField(request: Request, name: string): string {
  const body = request.body as Record<string, unknown> | undefined;
  const fromBody = body?.[name];
  if (typeof fromBody === "string" && fromBody.trim()) return fromBody.trim();
  const fromQuery = request.query[name];
  if (typeof fromQuery === "string" && fromQuery.trim()) return fromQuery.trim();
  const headerKey =
    name === "userId"
      ? "x-echofloor-user-id"
      : name === "organisationId"
        ? "x-echofloor-organisation-id"
        : null;
  if (headerKey) {
    const header = request.headers[headerKey];
    if (typeof header === "string" && header.trim()) return header.trim();
  }
  return "";
}

export async function requireLiveSession(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const db = getDb();
  if (!db) {
    response.status(503).json({
      success: false,
      error: {
        code: "UNAVAILABLE",
        message: "MongoDB is not connected.",
      },
    });
    return;
  }

  const userIdRaw = readField(request, "userId");
  const organisationIdRaw = readField(request, "organisationId");
  const userId = asObjectId(userIdRaw);
  const organisationId = asObjectId(organisationIdRaw);

  if (!userId || !organisationId) {
    response.status(401).json({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message: "userId and organisationId are required.",
      },
    });
    return;
  }

  const membership = await db.collection("memberships").findOne({
    userId,
    organisationId,
    status: { $in: ["active", "suspended"] },
  });
  if (!membership) {
    response.status(403).json({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "No active membership for this organisation.",
      },
    });
    return;
  }

  const user = await db.collection("users").findOne({ _id: userId });
  if (!user || user.status !== "active") {
    response.status(403).json({
      success: false,
      error: { code: "FORBIDDEN", message: "User account is not active." },
    });
    return;
  }

  request.liveSession = {
    userId: toId(userId),
    organisationId: toId(organisationId),
    role: membership.role === "admin" ? "admin" : "worker",
  };
  next();
}
