import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { GoogleAuthError, verifyGoogleIdToken } from "./auth/google.js";
import { integrationReport, type AppConfig } from "./config/env.js";
import { ensureIndexes } from "./db/indexes.js";
import { connectMongo, getDb } from "./db/mongo.js";
import { startSchedulers } from "./jobs/schedulers.js";
import { registerHandoverWorkflowRoutes } from "./routes/handoverWorkflow.js";
import { registerN8nAlertRoutes } from "./routes/n8nAlerts.js";
import { registerReportsVoiceRoutes } from "./routes/reportsVoice.js";
import { registerVoiceRoutes } from "./routes/voice.js";
import { registerWorkflowRoutes } from "./routes/workflows.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { registerSpaFallback } from "./static.js";

function corsOrigins(config: AppConfig): string[] | boolean {
  const listed = config.clientUrl
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const origins = new Set(listed);
  if (config.serverUrl) origins.add(config.serverUrl);
  if (origins.size === 0) return true;
  return [...origins];
}

export async function createApp(config: AppConfig) {
  const db = await connectMongo(config).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "MongoDB connection failed.";
    console.error(`EchoFloor MongoDB connection error: ${message}`);
    return null;
  });
  if (db) {
    await ensureIndexes(db).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Index setup failed.";
      console.error(`EchoFloor MongoDB index error: ${message}`);
    });
    // Cron keeps the Node process alive; skip in automated tests.
    if (config.nodeEnv !== "test") {
      startSchedulers(config);
    }
  }

  const app = express();
  app.disable("x-powered-by");
  // Issue reports may include a ~1.5MB photo as a data URL (~2MB JSON).
  app.use(express.json({ limit: "4mb" }));
  app.use(
    cors({
      origin: corsOrigins(config),
      credentials: true,
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({
      success: true,
      data: {
        status: "ok",
        service: "echofloor-api",
      },
    });
  });

  app.get(`${config.apiPrefix}/health`, (_request, response) => {
    const integrations = integrationReport(config);
    const mongoReady = Boolean(getDb());
    response.json({
      success: true,
      data: {
        status: "ok",
        service: "echofloor-api",
        environment: config.nodeEnv,
        integrations,
        dataApi: mongoReady ? "mongodb" : "not_implemented",
        googleClientIdConfigured: Boolean(config.googleClientId),
        note: mongoReady
          ? "Organisation workspace data is served from MongoDB when clients use VITE_DATA_SOURCE=api."
          : "MongoDB is not connected. Organisation data is not served until MONGODB_URI is set.",
      },
    });
  });

  app.post(`${config.apiPrefix}/auth/google`, async (request, response, next) => {
    try {
      const idToken =
        typeof request.body?.idToken === "string" ? request.body.idToken : "";
      const identity = await verifyGoogleIdToken(config.googleClientId, idToken);
      response.json({
        success: true,
        data: {
          provider: "google",
          ...identity,
        },
      });
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
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      next(error);
    }
  });

  registerWorkspaceRoutes(app, config);
  registerWorkflowRoutes(app, config);
  registerVoiceRoutes(app, config);
  registerReportsVoiceRoutes(app, config);
  registerHandoverWorkflowRoutes(app, config);
  registerN8nAlertRoutes(app, config);

  const spaMounted =
    config.nodeEnv === "production"
      ? registerSpaFallback(app, config.apiPrefix)
      : false;
  if (spaMounted) {
    console.info("EchoFloor serving the built client from client/dist.");
  }

  app.use((_request, response) => {
    response.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "This API route is not implemented.",
      },
    });
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
    void next;
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    response.status(500).json({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message:
          config.nodeEnv === "production"
            ? "The server could not complete the request."
            : message,
      },
    });
  };
  app.use(errorHandler);

  return app;
}
