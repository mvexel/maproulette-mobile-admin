import type { ServerResponse } from "node:http";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The participant claim page (deferred-signup-api.md §3.7, W1): a separate static app served
 * under /claim/. With CLAIM_BACKEND set (e.g. the mock at http://127.0.0.1:9300), the dev and
 * preview servers answer /claim/config.json with that backend and no map tiles, so tests never
 * reach the network. Builds are unaffected: the deployment writes its own config.json.
 */
function runtimeConfig(): Plugin {
  const middleware = (req: { url?: string }, res: ServerResponse, next: () => void) => {
    // The emailed links are /claim#t=…; Vite only serves under /claim/ (Caddy serves both).
    if (req.url === "/claim" || req.url?.startsWith("/claim?")) req.url = `/claim/${req.url.slice(6)}`;
    const backend = process.env.CLAIM_BACKEND;
    if (!backend || req.url?.split("?")[0] !== "/claim/config.json") return next();
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        backend,
        clientId: process.env.CLAIM_CLIENT_ID ?? "maproulette-claim",
        mapStyle: process.env.CLAIM_MAP_STYLE ?? "",
        osmWeb: process.env.CLAIM_OSM_WEB ?? "https://master.apis.dev.openstreetmap.org",
      }),
    );
  };
  return {
    name: "claim-runtime-config",
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
  };
}

export default defineConfig({
  root: "claim",
  base: "/claim/",
  plugins: [react(), runtimeConfig()],
  server: { port: 5174 },
  preview: { port: 4174 },
  build: { outDir: "../dist/claim", emptyOutDir: true },
});
