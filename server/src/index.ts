import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { ConfigError, loadConfig, missingOptionalNames } from "./config/env.js";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(serverDir, "../../.env");
dotenv.config({ path: envPath });

async function start() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    const message =
      error instanceof ConfigError ? error.message : "Invalid configuration.";
    console.error(`EchoFloor configuration error: ${message}`);
    process.exit(1);
  }

  const optional = missingOptionalNames(config);
  if (optional.length > 0 && config.nodeEnv !== "production") {
    console.info(
      `EchoFloor optional integrations unavailable: ${optional.join(", ")}. The API will report them as unavailable and will not simulate successful connections.`,
    );
  }

  const app = await createApp(config);
  app.listen(config.port, () => {
    console.info(
      `EchoFloor API listening on port ${config.port}. Health: ${config.apiPrefix}/health`,
    );
  });
}

void start();
