import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { GoogleAuthError, verifyGoogleIdToken } from "./auth/google.js";
import { integrationReport, type AppConfig } from "./config/env.js";

export function createApp(config: AppConfig) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin: config.clientUrl,
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
    response.json({
      success: true,
      data: {
        status: "ok",
        service: "echofloor-api",
        environment: config.nodeEnv,
        integrations,
        dataApi: "not_implemented",
        googleClientIdConfigured: Boolean(config.googleClientId),
        note: "This milestone validates configuration and reports integration availability. Organisation data is not served by the API. The frontend mockup uses labeled browser-session fixtures when VITE_DATA_SOURCE=mock. Google ID tokens are verified when GOOGLE_CLIENT_ID is set.",
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
