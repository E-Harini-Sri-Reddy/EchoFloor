import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Load VITE_* from the monorepo root .env (same file as the API).
  envDir: fileURLToPath(new URL("..", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
