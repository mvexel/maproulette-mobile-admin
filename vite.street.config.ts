import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { basename, dirname, extname, join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The participant site for streettally.osm.lol: the claim page (claim/, a React app under /claim/,
 * deferred-signup-api.md §3.7), the live progress page (claim/live.html, served at /live/<token>)
 * plus the static pages in site/ (the root page, the campaign landing
 * page at /challenge/<id> and the apple-app-site-association file). The build writes both to
 * dist-street/; production serves that folder with Caddy (deploy/Caddyfile, port 8080).
 *
 * The dev and preview servers serve site/ the way Caddy does. With CLAIM_BACKEND set (e.g. the mock
 * at http://127.0.0.1:9300), they also answer /config.json and /claim/config.json with that backend
 * and no map tiles, so tests never reach the network. APPLE_TEAM_ID and APPLE_BUNDLE_ID add the
 * apple-app-site-association file.
 */
const SITE = resolve(import.meta.dirname, "site");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".svg": "image/svg+xml",
};

function json(res: ServerResponse, body: unknown) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function participantSite(): Plugin {
  const middleware = (req: { url?: string }, res: ServerResponse, next: () => void) => {
    // The emailed links are /claim#t=…; Vite only serves under /claim/ (Caddy serves both).
    if (req.url === "/claim" || req.url?.startsWith("/claim?")) req.url = `/claim/${req.url.slice(6)}`;
    const path = req.url?.split("?")[0] ?? "";
    const backend = process.env.CLAIM_BACKEND;
    if (backend && path === "/claim/config.json")
      return json(res, {
        backend,
        clientId: process.env.CLAIM_CLIENT_ID ?? "maproulette-claim",
        mapStyle: process.env.CLAIM_MAP_STYLE ?? "",
        osmWeb: process.env.CLAIM_OSM_WEB ?? "https://master.apis.dev.openstreetmap.org",
      });
    if (backend && path === "/config.json")
      return json(res, { backend, installUrl: process.env.SITE_INSTALL_URL ?? "", appScheme: "mrchoice", androidInstallUrl: process.env.SITE_ANDROID_INSTALL_URL ?? "", androidVersion: process.env.SITE_ANDROID_VERSION ?? "" });
    if (path === "/.well-known/apple-app-site-association") {
      const team = process.env.APPLE_TEAM_ID;
      const bundle = process.env.APPLE_BUNDLE_ID;
      if (!team || !bundle) return next();
      return json(res, {
        applinks: { details: [{ appIDs: [`${team}.${bundle}`], components: [{ "/": "/challenge/*" }] }] },
      });
    }
    // The live progress page (BACKLOG #12): /live/<token> is the claim build's live.html.
    if (/^\/live\/[A-Za-z0-9_-]+\/?$/.test(path)) {
      req.url = "/claim/live.html";
      return next();
    }
    if (path.startsWith("/claim/")) return next();
    const file = /^\/challenge\/[^/]+\/?$/.test(path) ? "challenge.html" : path === "/" ? "index.html" : path === "/privacy" ? "privacy.html" : path === "/faq" ? "faq.html" : path.slice(1);
    const full = join(SITE, file);
    if (!full.startsWith(SITE) || !existsSync(full) || !statSync(full).isFile()) return next();
    res.setHeader("Content-Type", TYPES[extname(full)] ?? "application/octet-stream");
    res.end(readFileSync(full));
  };
  let outDir = "";
  return {
    name: "participant-site",
    configResolved: (config) => {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer: (server) => void server.middlewares.use(middleware),
    configurePreviewServer: (server) => void server.middlewares.use(middleware),
    // The claim app builds into dist-street/claim; the static pages go next to it.
    closeBundle: () => {
      if (basename(outDir) === "claim") cpSync(SITE, dirname(outDir), { recursive: true });
    },
  };
}

export default defineConfig({
  root: "claim",
  base: "/claim/",
  plugins: [react(), participantSite()],
  server: { port: 5174 },
  preview: { port: 4174 },
  build: {
    outDir: "../dist-street/claim",
    emptyOutDir: true,
    // The claim page, and the live progress page served at /live/<token> (deploy/Caddyfile).
    rollupOptions: { input: { claim: resolve(import.meta.dirname, "claim/index.html"), live: resolve(import.meta.dirname, "claim/live.html") } },
  },
});
