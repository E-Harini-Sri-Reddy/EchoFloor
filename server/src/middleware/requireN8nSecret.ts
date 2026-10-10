import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { AppConfig } from "../config/env.js";

export function requireN8nSecret(config: AppConfig) {
  const expected = config.n8nCallbackSecret?.trim() ?? "";
  const expectedBuf = Buffer.from(expected, "utf8");

  return (request: Request, response: Response, next: NextFunction) => {
    if (!expected) {
      response.status(503).json({
        success: false,
        error: {
          code: "UNAVAILABLE",
          message: "n8n callback authentication is not configured.",
        },
      });
      return;
    }
    const received = String(request.headers["n8n_callback_secret"] ?? "").trim();
    const receivedBuf = Buffer.from(received, "utf8");
    if (
      expectedBuf.length !== receivedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      response.status(401).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "Invalid callback secret." },
      });
      return;
    }
    next();
  };
}
