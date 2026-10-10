import type { Express, Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { verifyGoogleIdToken, GoogleAuthError } from "../auth/google.js";
import type { AppConfig } from "../config/env.js";
import { getDb } from "../db/mongo.js";
import {
  asObjectId,
  findActiveMembership,
  loadWorkspace,
  sessionFromDocs,
  toId,
} from "../db/workspace.js";

const SEED_PASSWORD = process.env.DEMO_SEED_PASSWORD?.trim() || "AdminTest-1";

function unavailable(response: Response) {
  response.status(503).json({
    success: false,
    error: {
      code: "UNAVAILABLE",
      message:
        "MongoDB is not connected. Set MONGODB_URI in .env and restart the API.",
    },
  });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

async function verifyPassword(
  userId: ObjectId,
  password: string,
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const credential = await db.collection("credentials").findOne({ userId });
  if (!credential) return false;
  const hash = String(credential.passwordHash ?? "");
  if (
    hash === "REPLACE_WITH_HASH" ||
    hash === "REPLACE_WITH_TEMP_HASH" ||
    hash.startsWith("REPLACE_")
  ) {
    return password === SEED_PASSWORD;
  }
  // Production: replace with bcrypt.compare(password, hash)
  return hash === password;
}

async function workspaceForUser(userId: ObjectId) {
  const db = getDb();
  if (!db) return null;
  const user = await db.collection("users").findOne({ _id: userId });
  if (!user || user.status !== "active") return null;
  const membership = await findActiveMembership(db, userId);
  if (!membership) return null;
  const orgId = asObjectId(toId(membership.organisationId));
  if (!orgId) return null;
  const session = sessionFromDocs(user, membership);
  const workspace = await loadWorkspace(db, orgId, session);
  return { session, workspace };
}

export function registerWorkspaceRoutes(app: Express, config: AppConfig) {
  const prefix = config.apiPrefix;

  app.post(
    `${prefix}/auth/login`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const email = normalizeEmail(String(request.body?.email ?? ""));
        const password = String(request.body?.password ?? "");
        if (!email || !password) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "Email and password are required." },
          });
          return;
        }
        const user = await db.collection("users").findOne({
          emailNormalized: email,
        });
        if (!user) {
          response.status(404).json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message:
                "No EchoFloor account was found for this email. If you represent an organisation, use Register to create one. If you are a worker, contact your organisation administrator for sign-in access.",
            },
          });
          return;
        }
        const providers = (user.authProviders as string[]) ?? [];
        const hasPassword = await db.collection("credentials").findOne({
          userId: user._id,
        });
        if (!hasPassword && providers.includes("google")) {
          const googleOnlyMessage =
            "This account was registered with Google. Please use Sign in with Google instead of email and password.";
          response.status(400).json({
            success: false,
            error: {
              code: "GOOGLE_ONLY",
              message: googleOnlyMessage,
              fieldErrors: { email: googleOnlyMessage },
            },
          });
          return;
        }
        const ok = await verifyPassword(user._id as ObjectId, password);
        if (!ok) {
          response.status(401).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Email or password is incorrect.",
            },
          });
          return;
        }
        const packed = await workspaceForUser(user._id as ObjectId);
        if (!packed) {
          response.status(403).json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "This account has no active organisation membership.",
            },
          });
          return;
        }
        response.json({ success: true, data: packed });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/auth/google/session`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const idToken = String(request.body?.idToken ?? "");
        const identity = await verifyGoogleIdToken(config.googleClientId, idToken);
        const user = await db.collection("users").findOne({
          emailNormalized: identity.email,
        });
        if (!user) {
          response.status(404).json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message:
                "No EchoFloor account was found for this email. If you represent an organisation, use Register to create one. If you are a worker, contact your organisation administrator for sign-in access.",
            },
          });
          return;
        }
        await db.collection("users").updateOne(
          { _id: user._id },
          {
            $addToSet: { authProviders: "google" },
            $set: { updatedAt: new Date() },
          },
        );
        const packed = await workspaceForUser(user._id as ObjectId);
        if (!packed) {
          response.status(403).json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "This account has no active organisation membership.",
            },
          });
          return;
        }
        response.json({ success: true, data: packed });
      } catch (error) {
        if (error instanceof GoogleAuthError) {
          const status =
            error.code === "UNAVAILABLE"
              ? 503
              : error.code === "EMAIL_UNVERIFIED"
                ? 403
                : 401;
          response.status(status).json({
            success: false,
            error: { code: error.code, message: error.message },
          });
          return;
        }
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/auth/register`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const organisationName = String(request.body?.organisationName ?? "").trim();
        const displayName = String(request.body?.displayName ?? "").trim();
        const email = normalizeEmail(String(request.body?.email ?? ""));
        const password = String(request.body?.password ?? "");
        const viaGoogle = Boolean(request.body?.viaGoogle);

        if (organisationName.length < 2) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Enter the organisation name.",
              fieldErrors: { organisationName: "Enter the organisation name." },
            },
          });
          return;
        }
        if (displayName.length < 2) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Enter your name.",
              fieldErrors: { displayName: "Enter your name." },
            },
          });
          return;
        }
        if (!email.includes("@")) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Enter a valid email address.",
              fieldErrors: { email: "Enter a valid email address." },
            },
          });
          return;
        }
        if (!viaGoogle && password.length < 8) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Use at least 8 characters.",
              fieldErrors: { password: "Use at least 8 characters." },
            },
          });
          return;
        }

        const existing = await db.collection("users").findOne({ emailNormalized: email });
        if (existing) {
          const providers = (existing.authProviders as string[]) ?? [];
          const googleOnly =
            providers.includes("google") &&
            !(await db.collection("credentials").findOne({ userId: existing._id }));
          const message = googleOnly
            ? "That email is already registered with Google. Use Sign in with Google instead."
            : "That email is already registered. Sign in instead.";
          response.status(409).json({
            success: false,
            error: {
              code: "CONFLICT",
              message,
              fieldErrors: { email: message },
            },
          });
          return;
        }

        const slug = slugify(organisationName);
        if (!slug) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Use a name that can become an organisation identifier.",
              fieldErrors: {
                organisationName:
                  "Use a name that can become an organisation identifier.",
              },
            },
          });
          return;
        }
        const slugTaken = await db.collection("organisations").findOne({ slug });
        if (slugTaken) {
          response.status(409).json({
            success: false,
            error: {
              code: "CONFLICT",
              message: "An organisation with that identifier already exists.",
              fieldErrors: {
                organisationName:
                  "An organisation with that identifier already exists.",
              },
            },
          });
          return;
        }

        const now = new Date();
        const userId = new ObjectId();
        const orgId = new ObjectId();
        const membershipId = new ObjectId();

        await db.collection("users").insertOne({
          _id: userId,
          email,
          emailNormalized: email,
          displayName,
          authProviders: viaGoogle ? ["google"] : ["password"],
          status: "active",
          createdAt: now,
          updatedAt: now,
        });

        if (!viaGoogle) {
          await db.collection("credentials").insertOne({
            _id: new ObjectId(),
            userId,
            // Demo store: plaintext until bcrypt is wired. Prefer hashing before production.
            passwordHash: password,
            temporary: false,
            createdAt: now,
            updatedAt: now,
          });
        }

        await db.collection("organisations").insertOne({
          _id: orgId,
          name: organisationName,
          slug,
          status: "active",
          settings: {
            timezone: "Asia/Kolkata",
            defaultShiftDurationMinutes: 480,
            shiftPolicy: {
              templates: [
                {
                  kind: "morning",
                  label: "Morning",
                  startLocal: "06:00",
                  durationMinutes: 480,
                },
                {
                  kind: "afternoon",
                  label: "Afternoon",
                  startLocal: "14:00",
                  durationMinutes: 480,
                },
                {
                  kind: "night",
                  label: "Night",
                  startLocal: "22:00",
                  durationMinutes: 480,
                },
              ],
              rotation: "weekly",
              minRestHoursBetweenShifts: 11,
              timingChangeCooldownDays: 14,
              lastTimingChangedAt: null,
            },
          },
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        });

        await db.collection("memberships").insertOne({
          _id: membershipId,
          organisationId: orgId,
          userId,
          role: "admin",
          status: "active",
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        await db.collection("user_preferences").insertOne({
          _id: new ObjectId(),
          userId,
          organisationId: orgId,
          emailAlerts: true,
          showVoiceTextFirst: false,
          updatedAt: now,
        });

        const packed = await workspaceForUser(userId);
        response.status(201).json({ success: true, data: packed });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    `${prefix}/workspace`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const userId = asObjectId(String(request.query.userId ?? ""));
        if (!userId) {
          response.status(400).json({
            success: false,
            error: { code: "VALIDATION", message: "userId is required." },
          });
          return;
        }
        const packed = await workspaceForUser(userId);
        if (!packed) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Workspace not found." },
          });
          return;
        }
        response.json({ success: true, data: packed });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/members`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const organisationId = asObjectId(String(request.body?.organisationId ?? ""));
        const invitedBy = asObjectId(
          String(request.body?.addedBy ?? request.body?.invitedBy ?? ""),
        );
        const email = normalizeEmail(String(request.body?.email ?? ""));
        const temporaryPassword = String(request.body?.temporaryPassword ?? "").trim();
        const workerAccessType =
          request.body?.workerAccessType === "temporary" ? "temporary" : "permanent";
        const accessDuration = String(request.body?.accessDuration ?? "until_removed");
        const customExpiresAt = String(request.body?.customExpiresAt ?? "").trim();

        if (!organisationId || !invitedBy) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "organisationId and addedBy are required.",
            },
          });
          return;
        }
        if (!email.includes("@")) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Enter a valid email address.",
              fieldErrors: { email: "Enter a valid email address." },
            },
          });
          return;
        }
        if (temporaryPassword.length < 8) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Use at least 8 characters for the temporary password.",
              fieldErrors: {
                temporaryPassword: "Use at least 8 characters for the temporary password.",
              },
            },
          });
          return;
        }

        const inviterMembership = await db.collection("memberships").findOne({
          organisationId,
          userId: invitedBy,
          role: "admin",
          status: "active",
        });
        if (!inviterMembership) {
          response.status(403).json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Only an active administrator can add members.",
            },
          });
          return;
        }

        let accessExpiresAt: Date | null = null;
        if (workerAccessType === "permanent") {
          if (accessDuration !== "until_removed") {
            response.status(400).json({
              success: false,
              error: {
                code: "VALIDATION",
                message:
                  "Permanent workers stay active until manual removal or suspension.",
                fieldErrors: {
                  accessDuration:
                    "Permanent workers stay active until manual removal or suspension.",
                },
              },
            });
            return;
          }
        } else if (accessDuration === "custom") {
          const expires = new Date(customExpiresAt);
          if (!customExpiresAt || Number.isNaN(expires.getTime()) || expires <= new Date()) {
            response.status(400).json({
              success: false,
              error: {
                code: "VALIDATION",
                message: "Choose a valid future custom end date and time.",
                fieldErrors: {
                  accessDuration: "Choose a valid future custom end date and time.",
                },
              },
            });
            return;
          }
          accessExpiresAt = expires;
        } else {
          const offsets: Record<string, number> = {
            "24h": 24 * 60 * 60 * 1000,
            "1w": 7 * 24 * 60 * 60 * 1000,
            "1m": 30 * 24 * 60 * 60 * 1000,
          };
          const ms = offsets[accessDuration];
          if (!ms) {
            response.status(400).json({
              success: false,
              error: {
                code: "VALIDATION",
                message: "Choose how long temporary access should last.",
                fieldErrors: {
                  accessDuration: "Choose how long temporary access should last.",
                },
              },
            });
            return;
          }
          accessExpiresAt = new Date(Date.now() + ms);
        }

        const existing = await db.collection("users").findOne({ emailNormalized: email });
        if (existing) {
          const alreadyMember = await db.collection("memberships").findOne({
            organisationId,
            userId: existing._id,
            status: { $in: ["active", "suspended"] },
          });
          if (alreadyMember) {
            response.status(409).json({
              success: false,
              error: {
                code: "CONFLICT",
                message: "That person is already a member of this organisation.",
                fieldErrors: {
                  email: "That person is already a member of this organisation.",
                },
              },
            });
            return;
          }
        }

        const now = new Date();
        const userId = existing ? (existing._id as ObjectId) : new ObjectId();
        const membershipId = new ObjectId();
        const invitationId = new ObjectId();
        const displayName =
          existing?.displayName ??
          email.split("@")[0] ??
          email;

        if (!existing) {
          await db.collection("users").insertOne({
            _id: userId,
            email,
            emailNormalized: email,
            displayName,
            authProviders: ["password"],
            status: "active",
            createdAt: now,
            updatedAt: now,
          });
        } else {
          await db.collection("users").updateOne(
            { _id: userId },
            {
              $addToSet: { authProviders: "password" },
              $set: { updatedAt: now },
            },
          );
        }

        await db.collection("credentials").updateOne(
          { userId },
          {
            $set: {
              passwordHash: temporaryPassword,
              temporary: true,
              updatedAt: now,
            },
            $setOnInsert: {
              _id: new ObjectId(),
              userId,
              createdAt: now,
            },
          },
          { upsert: true },
        );

        await db.collection("memberships").insertOne({
          _id: membershipId,
          organisationId,
          userId,
          role: "worker",
          status: "active",
          workerAccessType,
          accessExpiresAt,
          accessDurationPreset: accessDuration,
          joinedAt: now,
          createdAt: now,
          updatedAt: now,
        });

        await db.collection("invitations").insertOne({
          _id: invitationId,
          organisationId,
          emailNormalized: email,
          role: "worker",
          workerAccessType,
          accessDurationPreset: accessDuration,
          accessExpiresAt,
          status: "accepted",
          invitedBy,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          createdAt: now,
          updatedAt: now,
        });

        await db.collection("user_preferences").updateOne(
          { userId, organisationId },
          {
            $set: {
              emailAlerts: true,
              showVoiceTextFirst: false,
              updatedAt: now,
            },
            $setOnInsert: {
              _id: new ObjectId(),
              userId,
              organisationId,
            },
          },
          { upsert: true },
        );

        const packed = await workspaceForUser(invitedBy);
        response.status(201).json({ success: true, data: packed });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/memberships/remove`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const membershipId = asObjectId(String(request.body?.membershipId ?? ""));
        const organisationId = asObjectId(String(request.body?.organisationId ?? ""));
        const removedBy = asObjectId(String(request.body?.removedBy ?? ""));
        const confirm = Boolean(request.body?.confirm);
        if (!membershipId || !organisationId || !removedBy) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "membershipId, organisationId, and removedBy are required.",
            },
          });
          return;
        }
        if (!confirm) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Confirm that you want to remove this member.",
            },
          });
          return;
        }
        const actorMembership = await db.collection("memberships").findOne({
          organisationId,
          userId: removedBy,
          role: "admin",
          status: "active",
        });
        if (!actorMembership) {
          response.status(403).json({
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Only an active administrator can remove members.",
            },
          });
          return;
        }
        const membership = await db.collection("memberships").findOne({
          _id: membershipId,
          organisationId,
          status: { $in: ["active", "suspended"] },
        });
        if (!membership) {
          response.status(404).json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "Membership not found.",
            },
          });
          return;
        }
        if (toId(membership.userId) === toId(removedBy)) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message:
                "You cannot remove yourself here. Use Leave organisation in Settings.",
            },
          });
          return;
        }
        if (membership.role === "admin") {
          const otherAdmins = await db.collection("memberships").countDocuments({
            organisationId,
            role: "admin",
            status: "active",
            _id: { $ne: membershipId },
          });
          if (otherAdmins === 0) {
            response.status(403).json({
              success: false,
              error: {
                code: "FORBIDDEN",
                message: "Cannot remove the only active administrator.",
              },
            });
            return;
          }
        }
        await db.collection("memberships").updateOne(
          { _id: membership._id },
          { $set: { status: "removed", updatedAt: new Date() } },
        );
        const packed = await workspaceForUser(removedBy);
        if (!packed) {
          response.status(500).json({
            success: false,
            error: {
              code: "UNAVAILABLE",
              message: "Member was removed, but the workspace could not be reloaded.",
            },
          });
          return;
        }
        response.json({ success: true, data: packed });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/memberships/leave`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const userId = asObjectId(String(request.body?.userId ?? ""));
        const organisationId = asObjectId(String(request.body?.organisationId ?? ""));
        const confirm = Boolean(request.body?.confirm);
        if (!userId || !organisationId) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "userId and organisationId are required.",
            },
          });
          return;
        }
        if (!confirm) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "Confirm that you want to leave this organisation.",
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
          response.status(404).json({
            success: false,
            error: {
              code: "NOT_FOUND",
              message: "No active membership was found for this organisation.",
            },
          });
          return;
        }
        if (membership.role === "admin") {
          const otherAdmins = await db.collection("memberships").countDocuments({
            organisationId,
            role: "admin",
            status: "active",
            userId: { $ne: userId },
          });
          if (otherAdmins === 0) {
            response.status(403).json({
              success: false,
              error: {
                code: "FORBIDDEN",
                message:
                  "You are the only administrator. Add another administrator before leaving.",
              },
            });
            return;
          }
        }
        await db.collection("memberships").updateOne(
          { _id: membership._id },
          { $set: { status: "removed", updatedAt: new Date() } },
        );
        response.json({ success: true, data: { left: true } });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    `${prefix}/machines`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const organisationId = asObjectId(String(request.body?.organisationId ?? ""));
        const createdBy = asObjectId(String(request.body?.createdBy ?? ""));
        if (!organisationId || !createdBy) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "organisationId and createdBy are required.",
            },
          });
          return;
        }
        const now = new Date();
        const machineCode = String(request.body?.machineCode ?? "").trim();
        const name = String(request.body?.name ?? "").trim();
        if (!machineCode || !name) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "machineCode and name are required.",
            },
          });
          return;
        }
        const doc = {
          _id: new ObjectId(),
          organisationId,
          machineCode,
          name,
          description: String(request.body?.description ?? "").trim() || undefined,
          location: {
            productionLine: String(request.body?.productionLine ?? "").trim() || undefined,
            area: String(request.body?.area ?? "").trim() || undefined,
          },
          machineType: String(request.body?.machineType ?? "").trim() || undefined,
          status: "active",
          nfc: {
            tagId: String(request.body?.nfcTagId ?? "").trim() || null,
            enabled: Boolean(String(request.body?.nfcTagId ?? "").trim()),
            registeredAt: String(request.body?.nfcTagId ?? "").trim() ? now : undefined,
          },
          createdBy,
          createdAt: now,
          updatedAt: now,
        };
        await db.collection("machines").insertOne(doc);
        const packed = await workspaceForUser(createdBy);
        response.status(201).json({
          success: true,
          data: {
            machineId: toId(doc._id),
            workspace: packed?.workspace ?? null,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    `${prefix}/machines/:machineId`,
    async (request: Request, response: Response, next: NextFunction) => {
      try {
        const db = getDb();
        if (!db) return unavailable(response);
        const machineId = asObjectId(String(request.params.machineId ?? ""));
        const organisationId = asObjectId(String(request.body?.organisationId ?? ""));
        const updatedBy = asObjectId(String(request.body?.updatedBy ?? ""));
        if (!machineId || !organisationId || !updatedBy) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "machineId, organisationId, and updatedBy are required.",
            },
          });
          return;
        }
        const machineCode = String(request.body?.machineCode ?? "").trim();
        const name = String(request.body?.name ?? "").trim();
        if (!machineCode || !name) {
          response.status(400).json({
            success: false,
            error: {
              code: "VALIDATION",
              message: "machineCode and name are required.",
            },
          });
          return;
        }
        const existing = await db.collection("machines").findOne({
          _id: machineId,
          organisationId,
        });
        if (!existing) {
          response.status(404).json({
            success: false,
            error: { code: "NOT_FOUND", message: "Machine not found." },
          });
          return;
        }
        const now = new Date();
        const tag = String(request.body?.nfcTagId ?? "").trim();
        const existingNfc = (existing.nfc ?? {}) as {
          tagId?: string | null;
          registeredAt?: Date;
        };
        const update = {
          machineCode,
          name,
          description: String(request.body?.description ?? "").trim() || undefined,
          location: {
            productionLine:
              String(request.body?.productionLine ?? "").trim() || undefined,
            area: String(request.body?.area ?? "").trim() || undefined,
          },
          machineType: String(request.body?.machineType ?? "").trim() || undefined,
          nfc: tag
            ? {
                tagId: tag,
                enabled: true,
                registeredAt:
                  existingNfc.tagId === tag && existingNfc.registeredAt
                    ? existingNfc.registeredAt
                    : now,
              }
            : { tagId: null, enabled: false },
          updatedBy,
          updatedAt: now,
        };
        await db.collection("machines").updateOne({ _id: machineId }, { $set: update });
        const packed = await workspaceForUser(updatedBy);
        response.json({
          success: true,
          data: {
            machineId: toId(machineId),
            workspace: packed?.workspace ?? null,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );
}
