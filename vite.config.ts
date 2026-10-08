/// <reference types="vitest/config" />

import type { ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * With ADMIN_BACKEND set (e.g. the mock at http://127.0.0.1:9300), the dev and preview servers
 * answer /config.json with that backend instead of public/config.json. Builds are unaffected:
 * the deployed container writes its own config.json.
 */
function runtimeConfig(): Plugin {
  const middleware = (req: { url?: string }, res: ServerResponse, next: () => void) => {
    const backend = process.env.ADMIN_BACKEND;
    if (!backend || req.url?.split("?")[0] !== "/config.json") return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ backend, clientId: process.env.ADMIN_CLIENT_ID ?? "maproulette-mobile-admin", ...(process.env.ADMIN_JOBS ? { jobs: process.env.ADMIN_JOBS, jobsPollMs: Number(process.env.ADMIN_JOBS_POLL_MS ?? 2000) } : {}) }));
  };
  return {
    name: "runtime-config",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  plugins: [react(), runtimeConfig()],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
