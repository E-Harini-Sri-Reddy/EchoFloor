import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import express from "express";

/** Built Vite client relative to this file (works from src/ and dist/). */
export function clientDistPath() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../client/dist");
}

export function registerSpaFallback(app: Express, apiPrefix: string) {
  const dist = clientDistPath();
  const indexHtml = path.join(dist, "index.html");
  if (!existsSync(indexHtml)) {
    return false;
  }

  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  app.get(/.*/, (request, response, next) => {
    if (
      request.path === "/health" ||
      request.path.startsWith(`${apiPrefix}/`) ||
      request.path === apiPrefix
    ) {
      next();
      return;
    }
    response.sendFile(indexHtml);
  });
  return true;
}
