/**
 * A mock of the fork's mobile OAuth provider and admin API, for tests and local development.
 * No network beyond loopback, no dependencies. Response shapes follow the backend's
 * docs/mobile-oauth.md and docs/mobile-admin-api.md (MobileOAuthController,
 * MobileAdminController). Instead of the OSM login, /oauth/mobile/authorize shows a page that
 * lets you sign in as a super-user or as a plain user (who gets access_denied).
 *
 * Run: node mock/server.ts   (MOCK_PORT=9300, MOCK_ADMIN_ORIGIN=http://localhost:5173)
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockOptions {
  /** Origin of the admin app, for CORS and the seeded admin client's redirect. */
  adminOrigin: string;
  /** Access token lifetime in seconds (backend default 900). */
  accessSeconds?: number;
  /** Number of audit rows seeded at start and on reset. */
  auditSeed?: number;
}

interface Client {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  enabled: boolean;
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Audit {
  id: number;
  actorUserId: number;
  action: string;
  target: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

interface User {
  id: number;
  osmId: number;
  displayName: string;
  superUser: boolean;
}

interface Family {
  userId: number;
  clientId: string;
  scope: string;
  revoked: boolean;
  /** Hash-free in the mock: the current refresh token and every one it replaced. */
  refresh: string;
  used: Set<string>;
}

const USERS: Record<string, User> = {
  super: { id: 7, osmId: 70007, displayName: "mock-superuser", superUser: true },
  plain: { id: 8, osmId: 80008, displayName: "mock-mapper", superUser: false },
};

const ADMIN_SCOPE = "mobile:admin";
const SCOPE_SETS = [
  "tasks:read",
  "tasks:read tasks:write",
  "tasks:read tasks:write osm:tagfix",
  ADMIN_SCOPE,
];
const token = () => randomBytes(32).toString("base64url"); // 43 characters, like the backend
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

const JOB_STEPS = ["queued", "submitting", "slicing", "downloading", "converting", "complete"] as const;
const MAX_ACTIVE_JOBS = 3;
const MAX_JOB_AREA_KM2 = 5000;

interface MockJob {
  id: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  input: { region: unknown; rules: Record<string, string>[]; name: string };
  progress: { stage: string; fraction: number | null; message: string };
  error: { code: string; message: string } | null;
  result: unknown;
}

export interface MockBackend {
  server: Server;
  /** Base URL once listening, e.g. http://127.0.0.1:9300. */
  url: string;
  close(): Promise<void>;
  reset(): void;
  /** Makes every issued access token invalid, as if they had expired on the server. */
  expireAccess(): void;
  stats: { authorizationCodes: number; refreshes: number; revokes: number; replays: number };
}

export function createMockBackend(opts: MockOptions): MockBackend {
  const adminOrigin = opts.adminOrigin.replace(/\/+$/, "");
  const accessSeconds = opts.accessSeconds ?? 900;

  let clients = new Map<string, Client>();
  let audit: Audit[] = [];
  let writePolicy = false;
  let jobs: MockJob[] = [];
  let jobSeq = 0;
  let interactions = new Map<string, { clientId: string; redirectUri: string; state: string; challenge: string }>();
  let codes = new Map<string, { userId: number; clientId: string; redirectUri: string; challenge: string; expires: number }>();
  let families = new Map<string, Family>();
  let refreshIndex = new Map<string, string>(); // refresh token -> family id
  let accessTokens = new Map<string, { family: string; expires: number }>();
  const stats = { authorizationCodes: 0, refreshes: 0, revokes: 0, replays: 0 };

  function seedClient(c: Pick<Client, "id" | "name" | "redirectUris" | "scopes">) {
    const now = new Date(Date.UTC(2026, 9, 7)).toISOString();
    clients.set(c.id, { ...c, enabled: true, createdBy: null, updatedBy: null, createdAt: now, updatedAt: now });
  }

  function reset() {
    clients = new Map();
    seedClient({
      id: "maproulette-mobile-admin",
      name: "MapRoulette Mobile Admin",
      redirectUris: [`${adminOrigin}/callback`],
      scopes: [ADMIN_SCOPE],
    });
    seedClient({
      id: "maproulette-android-example",
      name: "MapRoulette Android Example",
      redirectUris: ["org.maproulette.example:/oauth2redirect"],
      scopes: ["tasks:read", "tasks:write", "osm:tagfix"],
    });
    seedClient({
      id: "maproulette-ios-example",
      name: "MapRoulette iOS Example",
      redirectUris: ["org.maproulette.example:/oauth2redirect"],
      scopes: ["tasks:read", "tasks:write"],
    });
    audit = [];
    writePolicy = false;
    jobs = [];
    jobSeq = 0;
    for (let i = 1; i <= (opts.auditSeed ?? 60); i++) {
      audit.push({
        id: i,
        actorUserId: USERS.super.id,
        action: i % 3 === 0 ? "client.update" : "stock.PUT",
        target: i % 3 === 0 ? "maproulette-ios-example" : `/api/v2/challenge/${i}`,
        ...(i % 3 === 0 ? { before: { enabled: true }, after: { enabled: false } } : { after: { status: 200 } }),
        createdAt: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
      });
    }
    interactions = new Map();
    codes = new Map();
    families = new Map();
    refreshIndex = new Map();
    accessTokens = new Map();
    stats.authorizationCodes = stats.refreshes = stats.revokes = stats.replays = 0;
  }
  reset();

  function record(actor: number, action: string, target: string, before: unknown, after: unknown) {
    const id = (audit.at(-1)?.id ?? 0) + 1;
    audit.push({
      id,
      actorUserId: actor,
      action,
      target,
      ...(before === undefined ? {} : { before }),
      after,
      createdAt: new Date().toISOString(),
    });
  }

  function issue(familyId: string) {
    const f = families.get(familyId)!;
    const access = token();
    const refresh = token();
    accessTokens.set(access, { family: familyId, expires: Date.now() + accessSeconds * 1000 });
    f.used.add(f.refresh);
    f.refresh = refresh;
    refreshIndex.set(refresh, familyId);
    return { access_token: access, token_type: "Bearer", expires_in: accessSeconds, refresh_token: refresh, scope: f.scope };
  }

  function revokeFamily(familyId: string) {
    const f = families.get(familyId);
    if (!f) return;
    f.revoked = true;
    for (const [t, a] of accessTokens) if (a.family === familyId) accessTokens.delete(t);
  }

  /** Bearer authentication, as MobileBearerFilter: a disabled client is unknown. */
  function bearer(req: IncomingMessage): { user: User; family: Family } | undefined {
    const m = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? "");
    const a = m && accessTokens.get(m[1]);
    if (!a || a.expires < Date.now()) return undefined;
    const f = families.get(a.family)!;
    if (f.revoked || !clients.get(f.clientId)?.enabled) return undefined;
    const user = Object.values(USERS).find((u) => u.id === f.userId)!;
    return { user, family: f };
  }

  // --- validation, as MobileAdminController.parseClient / parsePatch ---------------------------
  const nameError = "name: 1 to 200 characters, no surrounding spaces or control characters";
  const redirectError =
    "redirectUris: 1 to 10 distinct URIs, each https://host/... or a reverse-domain custom scheme (com.example.app:/path), without query or fragment";
  const scopesError =
    'scopes: ["tasks:read"], ["tasks:read","tasks:write"], ["tasks:read","tasks:write","osm:tagfix"] or ["mobile:admin"]';

  const validName = (v: unknown) =>
    typeof v === "string" && v.trim() !== "" && v.trim() === v && v.length <= 200 && !/\p{Cc}/u.test(v);
  const validRedirect = (u: string) => {
    if (u.length > 2048 || /[?#]/.test(u)) return false;
    if (/^https:\/\/[^/@\s]+(\/[^\s]*)?$/.test(u)) return true;
    return /^[a-z][a-z0-9]*(\.[a-z0-9_-]+)+:\/[^\s/][^\s]*$/i.test(u);
  };
  const validRedirects = (v: unknown) =>
    Array.isArray(v) &&
    v.length >= 1 &&
    v.length <= 10 &&
    v.every((u) => typeof u === "string" && validRedirect(u)) &&
    new Set(v).size === v.length;
  const parseScopes = (v: unknown): string[] | undefined => {
    if (!Array.isArray(v) || !v.every((s) => typeof s === "string")) return undefined;
    const order = ["tasks:read", "tasks:write", "osm:tagfix", ADMIN_SCOPE];
    if (new Set(v).size !== v.length) return undefined;
    const sorted = [...v].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return SCOPE_SETS.includes(sorted.join(" ")) ? sorted : undefined;
  };

  function checkFields(body: unknown, allowed: string[]): string[] | Record<string, unknown> {
    if (typeof body !== "object" || body === null || Array.isArray(body)) return ["expected a JSON object"];
    const unknown = Object.keys(body).filter((k) => !allowed.includes(k)).sort();
    return unknown.length ? unknown.map((k) => `unknown field ${k}`) : (body as Record<string, unknown>);
  }

  // --- HTTP plumbing -----------------------------------------------------------------------------
  function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
    res.writeHead(status, {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      "Cache-Control": "no-store",
      ...headers,
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  }
  const problem = (res: ServerResponse, status: number, error: string, detail?: string[]) =>
    send(res, status, detail?.length ? { error, detail } : { error });

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  const corsPaths = (path: string) =>
    path.startsWith("/api/v2/mobile-admin/") || path === "/jobs" || path.startsWith("/jobs/") || ["/oauth/mobile/token", "/oauth/mobile/revoke", "/oauth/mobile/me"].includes(path);

  /** MobileCorsFilter: the admin origin only, no credentials; other origins' preflights get 403. */
  function cors(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    const origin = req.headers.origin;
    if (!origin || !corsPaths(path)) return false;
    if (origin !== adminOrigin) {
      if (req.method === "OPTIONS") {
        send(res, 403);
        return true;
      }
      return false;
    }
    res.setHeader("Access-Control-Allow-Origin", adminOrigin);
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": String(req.headers["access-control-request-method"] ?? "GET"),
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
        "Access-Control-Max-Age": "600",
      });
      res.end();
      return true;
    }
    return false;
  }

  const appRedirect = (res: ServerResponse, redirectUri: string, params: Record<string, string>) => {
    res.writeHead(303, { Location: `${redirectUri}?${new URLSearchParams(params)}`, "Cache-Control": "no-store" });
    res.end();
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://mock");
    const path = url.pathname;
    if (cors(req, res, path)) return;
    const q = url.searchParams;

    // Test controls (not part of the real backend).
    if (path === "/__mock/reset" && req.method === "POST") {
      reset();
      return send(res, 204);
    }
    if (path === "/__mock/expire-access" && req.method === "POST") {
      expireAccess();
      return send(res, 204);
    }
    if (path === "/__mock/stats" && req.method === "GET") return send(res, 200, stats);
    if (path === "/__mock/jobs/expire" && req.method === "POST") {
      for (const j of jobs) if (j.state === "complete") expireJob(j);
      return send(res, 204);
    }

    if (path === "/jobs/health" && req.method === "GET") return send(res, 200, { ok: true });
    if (path === "/jobs" || path.startsWith("/jobs/")) {
      // Like the real service: validate the bearer by the admin-only write-policy probe.
      const b = bearer(req);
      if (!b) return send(res, 401, { error: "invalid_token", message: "Sign in again." });
      if (b.family.scope !== ADMIN_SCOPE || !b.user.superUser) return send(res, 403, { error: "admin_required", message: "Admin only." });
      return jobsApi(req, res, path);
    }

    if (path === "/oauth/mobile/authorize" && req.method === "GET") {
      const client = clients.get(q.get("client_id") ?? "");
      const redirectUri = q.get("redirect_uri") ?? "";
      if (!client?.enabled) return problem(res, 401, "invalid_client");
      if (!client.redirectUris.includes(redirectUri)) return problem(res, 400, "invalid_request");
      if (
        q.get("response_type") !== "code" ||
        q.get("code_challenge_method") !== "S256" ||
        !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "") ||
        !q.get("state")
      )
        return problem(res, 400, "invalid_request");
      if (q.get("scope") !== client.scopes.join(" ") || !client.scopes.includes(ADMIN_SCOPE))
        return problem(res, 400, "invalid_scope");
      const tx = token();
      interactions.set(tx, { clientId: client.id, redirectUri, state: q.get("state")!, challenge: q.get("code_challenge")! });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><title>Mock sign-in</title><h1>Mock MapRoulette sign-in</h1>
<p>Client <code>${client.id}</code> asks for <code>${ADMIN_SCOPE}</code>. This mock replaces the OSM login and consent.</p>
<p><a href="/oauth/mobile/authorize/decide?tx=${tx}&as=super">Sign in as ${USERS.super.displayName} (super-user)</a></p>
<p><a href="/oauth/mobile/authorize/decide?tx=${tx}&as=plain">Sign in as ${USERS.plain.displayName} (not a super-user)</a></p>`);
      return;
    }

    if (path === "/oauth/mobile/authorize/decide" && req.method === "GET") {
      const i = interactions.get(q.get("tx") ?? "");
      const user = USERS[q.get("as") ?? ""];
      if (!i || !user) return problem(res, 400, "invalid_request");
      interactions.delete(q.get("tx")!);
      if (!user.superUser)
        return appRedirect(res, i.redirectUri, {
          error: "access_denied",
          error_description: "MapRoulette super-user required",
          state: i.state,
        });
      const code = token();
      codes.set(code, { userId: user.id, clientId: i.clientId, redirectUri: i.redirectUri, challenge: i.challenge, expires: Date.now() + 120_000 });
      return appRedirect(res, i.redirectUri, { code, state: i.state });
    }

    if (path === "/oauth/mobile/token" && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req));
      const client = clients.get(f.get("client_id") ?? "");
      if (!client?.enabled) return problem(res, 401, "invalid_client");
      if (f.get("grant_type") === "authorization_code") {
        const code = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? ""); // single use
        if (
          !code ||
          code.expires < Date.now() ||
          code.clientId !== client.id ||
          code.redirectUri !== f.get("redirect_uri") ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(f.get("code_verifier") ?? "") ||
          s256(f.get("code_verifier") ?? "") !== code.challenge
        )
          return problem(res, 400, "invalid_grant");
        const familyId = token();
        families.set(familyId, { userId: code.userId, clientId: client.id, scope: ADMIN_SCOPE, revoked: false, refresh: "", used: new Set() });
        stats.authorizationCodes++;
        return send(res, 200, issue(familyId));
      }
      if (f.get("grant_type") === "refresh_token") {
        const presented = f.get("refresh_token") ?? "";
        const familyId = refreshIndex.get(presented);
        const fam = familyId ? families.get(familyId) : undefined;
        if (!familyId || !fam || fam.revoked || fam.clientId !== client.id) return problem(res, 400, "invalid_grant");
        if (fam.refresh !== presented) {
          // Replay of a rotated token: revoke the whole family.
          stats.replays++;
          revokeFamily(familyId);
          return problem(res, 400, "invalid_grant");
        }
        if (f.has("scope") && f.get("scope") !== fam.scope) return problem(res, 400, "invalid_scope");
        stats.refreshes++;
        return send(res, 200, issue(familyId));
      }
      return problem(res, 400, "unsupported_grant_type");
    }

    if (path === "/oauth/mobile/revoke" && req.method === "POST") {
      const f = new URLSearchParams(await readBody(req));
      if (!clients.has(f.get("client_id") ?? "") || !f.get("token") || req.headers.authorization)
        return problem(res, 401, "invalid_client");
      const t = f.get("token")!;
      const familyId = refreshIndex.get(t) ?? accessTokens.get(t)?.family;
      if (familyId && families.get(familyId)?.clientId === f.get("client_id")) revokeFamily(familyId);
      stats.revokes++;
      return send(res, 200); // unknown tokens succeed too
    }

    if (path === "/oauth/mobile/me" && req.method === "GET") {
      const b = bearer(req);
      if (!b) return problem(res, 401, "invalid_token");
      return send(res, 200, { id: b.user.id, osmId: b.user.osmId, displayName: b.user.displayName, scope: b.family.scope });
    }

    if (path.startsWith("/api/v2/mobile-admin/")) {
      if (!req.headers.authorization) return problem(res, 403, "mobile_admin_only");
      const b = bearer(req);
      if (!b) return problem(res, 401, "invalid_token");
      if (b.family.scope !== ADMIN_SCOPE) return problem(res, 403, "insufficient_scope");
      if (!b.user.superUser) return problem(res, 403, "admin_required");
      return admin(req, res, path, q, b.user, b.family);
    }

    return problem(res, 404, "not_found");
  }

  // --- extraction jobs (docs: .scratch-7/job-api.md) --------------------------------------------
  const jobError = (res: ServerResponse, status: number, error: string, message: string) => send(res, status, { error, message });

  function expireJob(j: MockJob) {
    j.state = "expired";
    j.result = null;
    j.progress = { stage: "expired", fraction: null, message: "Results expired" };
  }

  /** Each read of an active job moves it one step: deterministic, no timers. */
  function advance(j: MockJob) {
    if (!["queued", "submitting", "slicing", "downloading", "converting"].includes(j.state)) return;
    const now = new Date().toISOString();
    j.updatedAt = now;
    const failing = j.input.name.includes("[fail]");
    if (failing && j.state === "slicing") {
      j.state = "failed";
      j.error = { code: "too_large", message: "The region contains too many nodes for one extract. Choose a smaller area." };
      j.progress = { stage: "failed", fraction: null, message: j.error.message };
      return;
    }
    const next = JOB_STEPS[JOB_STEPS.indexOf(j.state as (typeof JOB_STEPS)[number]) + 1];
    j.state = next;
    j.progress = { stage: next, fraction: next === "complete" ? 1 : JOB_STEPS.indexOf(next) / (JOB_STEPS.length - 1), message: next === "complete" ? "Done" : `Working: ${next}` };
    if (next === "complete") j.result = jobResult(j);
  }

  function jobBbox(j: MockJob): [number, number, number, number] {
    const region = j.input.region as { type: string; bbox?: number[]; geometry?: { coordinates: unknown } };
    if (region.type === "bbox") return region.bbox as [number, number, number, number];
    const pts: number[][] = [];
    const walk = (c: unknown) => (Array.isArray(c) && typeof c[0] === "number" ? pts.push(c as number[]) : (c as unknown[]).forEach(walk));
    walk(region.geometry?.coordinates);
    const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
    return [Math.min(...ys), Math.min(...xs), Math.max(...ys), Math.max(...xs)];
  }

  function jobFeatures(j: MockJob) {
    const [s, w, n, e] = jobBbox(j);
    const tags = Object.fromEntries(Object.entries(j.input.rules[0] ?? {}).map(([k, v]) => [k, v === "*" ? "yes" : v]));
    return {
      type: "FeatureCollection",
      features: [0.25, 0.5, 0.75].map((f, i) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [w + (e - w) * f, s + (n - s) * f] },
        properties: { "@id": `node/${1000001 + i}`, ...tags, name: `Fixture ${i + 1}` },
      })),
    };
  }

  function jobResult(j: MockJob) {
    return {
      featureCount: 3,
      counts: { candidates: 5, emitted: 3, duplicates: 1, outside_region: 0, omitted: 1 },
      omissions: [{ id: "way/4242", reason: "no_representative_point", detail: "Way has no resolvable nodes in the extract" }],
      omissionTotal: 1,
      provenance: {
        sliceosmJobId: `00000000-0000-4000-8000-${String(jobSeq).padStart(12, "0")}`,
        sourceTimestamp: "2026-10-07T00:00:00Z",
        pbfSha256: "ab".repeat(32),
        pbfBytes: 123456,
        request: { region: j.input.region },
        rules: j.input.rules,
        createdAt: j.createdAt,
      },
    };
  }

  async function jobsApi(req: IncomingMessage, res: ServerResponse, path: string) {
    if (path === "/jobs" && req.method === "GET") {
      for (const j of jobs) advance(j);
      return send(res, 200, { jobs: [...jobs].reverse().slice(0, 50) });
    }
    if (path === "/jobs" && req.method === "POST") {
      let body: { name?: unknown; region?: { type?: unknown; bbox?: unknown; geometry?: unknown }; rules?: unknown };
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return jobError(res, 422, "invalid_request", "Body must be JSON");
      }
      const problems: string[] = [];
      if (typeof body.name !== "string" || !body.name.trim()) problems.push("name is required");
      const rules = body.rules;
      if (!Array.isArray(rules) || rules.length < 1 || rules.length > 10 || !rules.every((r) => r && typeof r === "object" && Object.keys(r).length > 0 && Object.values(r).every((v) => typeof v === "string" && v !== "")))
        problems.push("rules: 1 to 10 non-empty rules");
      const region = body.region;
      if (region?.type === "bbox") {
        const bb = region.bbox;
        if (!Array.isArray(bb) || bb.length !== 4 || !bb.every((v) => typeof v === "number" && Number.isFinite(v))) problems.push("bbox: four numbers");
        else {
          const [s, w, n, e] = bb as number[];
          if (s >= n || w >= e || s < -90 || n > 90 || w < -180 || e > 180) problems.push("bbox: order or range invalid");
          else if (6371.0088 ** 2 * ((e - w) * Math.PI / 180) * (Math.sin(n * Math.PI / 180) - Math.sin(s * Math.PI / 180)) > MAX_JOB_AREA_KM2) problems.push("area exceeds the limit");
        }
      } else if (region?.type === "geojson") {
        const g = region.geometry as { type?: string } | undefined;
        if (g?.type !== "Polygon" && g?.type !== "MultiPolygon") problems.push("geometry: Polygon or MultiPolygon");
      } else problems.push("region.type: bbox or geojson");
      if (problems.length) return jobError(res, 422, "invalid_request", problems.join("; "));
      if (jobs.filter((j) => ["queued", "submitting", "slicing", "downloading", "converting"].includes(j.state)).length >= MAX_ACTIVE_JOBS)
        return jobError(res, 429, "too_many_active_jobs", `At most ${MAX_ACTIVE_JOBS} active jobs`);
      const now = new Date().toISOString();
      const job: MockJob = {
        id: `00000000-0000-4000-8000-${String(++jobSeq).padStart(12, "0")}`,
        state: "queued", createdAt: now, updatedAt: now,
        input: { region: body.region, rules: rules as Record<string, string>[], name: body.name as string },
        progress: { stage: "queued", fraction: 0, message: "Waiting for a worker" },
        error: null, result: null,
      };
      jobs.push(job);
      return send(res, 201, job);
    }
    const m = /^\/jobs\/([^/]+)(?:\/(features|cancel))?$/.exec(path);
    const job = m && jobs.find((j) => j.id === m[1]);
    if (!m || !job) return jobError(res, 404, "not_found", "No such job");
    if (!m[2] && req.method === "GET") {
      advance(job);
      return send(res, 200, job);
    }
    if (m[2] === "cancel" && req.method === "POST") {
      if (["queued", "submitting", "slicing", "downloading", "converting"].includes(job.state)) {
        job.state = "cancelled";
        job.progress = { stage: "cancelled", fraction: null, message: "Cancelled" };
        job.updatedAt = new Date().toISOString();
      }
      return send(res, 200, job);
    }
    if (m[2] === "features" && req.method === "GET") {
      if (job.state === "expired") return jobError(res, 410, "expired", "Results were purged");
      if (job.state !== "complete") return jobError(res, 409, "not_complete", "Job is not complete");
      return send(res, 200, jobFeatures(job), { "Content-Type": "application/geo+json" });
    }
    return jobError(res, 404, "not_found", "No such route");
  }

  const clientJson = (c: Client) => ({
    id: c.id,
    name: c.name,
    redirectUris: [...c.redirectUris].sort(),
    scopes: c.scopes,
    enabled: c.enabled,
  });
  const listJson = (c: Client) => ({
    ...clientJson(c),
    source: c.createdBy === null ? "config" : "admin",
    createdBy: c.createdBy,
    updatedBy: c.updatedBy,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  });

  async function admin(req: IncomingMessage, res: ServerResponse, path: string, q: URLSearchParams, user: User, family: Family) {
    if (path === "/api/v2/mobile-admin/write-policy" && req.method === "GET")
      return send(res, 200, { enabled: writePolicy, managed: true });
    if (path === "/api/v2/mobile-admin/clients" && req.method === "GET")
      return send(res, 200, { clients: [...clients.values()].sort((a, b) => a.id.localeCompare(b.id)).map(listJson) });

    if (path === "/api/v2/mobile-admin/audit" && req.method === "GET") {
      const limit = Number(q.get("limit") ?? 50);
      const page = Number(q.get("page") ?? 0);
      if (!Number.isInteger(limit) || !Number.isInteger(page) || limit < 1 || limit > 200 || page < 0 || page > 100000)
        return problem(res, 400, "invalid_request", ["limit 1-200, page >= 0"]);
      const newest = [...audit].reverse();
      return send(res, 200, { items: newest.slice(page * limit, page * limit + limit), page, limit, total: audit.length });
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return problem(res, 400, "invalid_request");
    }

    if (path === "/api/v2/mobile-admin/write-policy" && req.method === "PUT") {
      const v = checkFields(body, ["enabled"]);
      if (Array.isArray(v) || typeof v.enabled !== "boolean")
        return problem(res, 400, "invalid_request", ["expected only enabled"]);
      if (writePolicy !== v.enabled) {
        record(user.id, "write_policy.update", "mobile", { enabled: writePolicy }, { enabled: v.enabled });
        writePolicy = v.enabled;
      }
      return send(res, 200, { enabled: writePolicy, managed: true });
    }

    if (path === "/api/v2/mobile-admin/clients" && req.method === "POST") {
      const v = checkFields(body, ["id", "name", "redirectUris", "scopes", "enabled"]);
      if (Array.isArray(v)) return problem(res, 400, "invalid_request", v);
      const errors: string[] = [];
      if (typeof v.id !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(v.id)) errors.push("id: 1 to 100 of A-Z a-z 0-9 . _ -");
      if (!("name" in v)) errors.push("name is required");
      else if (!validName(v.name)) errors.push(nameError);
      if (!("redirectUris" in v)) errors.push("redirectUris is required");
      else if (!validRedirects(v.redirectUris)) errors.push(redirectError);
      const scopes = "scopes" in v ? parseScopes(v.scopes) : ["tasks:read"];
      if (!scopes) errors.push(scopesError);
      if ("enabled" in v && typeof v.enabled !== "boolean") errors.push("enabled: true or false");
      if (errors.length) return problem(res, 400, "invalid_request", errors);
      if (clients.has(v.id as string)) return problem(res, 409, "client_exists");
      const now = new Date().toISOString();
      const c: Client = {
        id: v.id as string,
        name: v.name as string,
        redirectUris: v.redirectUris as string[],
        scopes: scopes!,
        enabled: (v.enabled as boolean | undefined) ?? true,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      };
      clients.set(c.id, c);
      record(user.id, "client.create", c.id, undefined, clientJson(c));
      return send(res, 201, clientJson(c));
    }

    const m = /^\/api\/v2\/mobile-admin\/clients\/([^/]+)$/.exec(path);
    if (m && req.method === "PATCH") {
      const id = decodeURIComponent(m[1]);
      const revokeGrants = q.get("revokeGrants") === "true";
      const v = checkFields(body, ["name", "redirectUris", "scopes", "enabled"]);
      if (Array.isArray(v)) return problem(res, 400, "invalid_request", v);
      if (Object.keys(v).length === 0) return problem(res, 400, "invalid_request", ["nothing to change"]);
      const errors: string[] = [];
      if ("name" in v && !validName(v.name)) errors.push(nameError);
      if ("redirectUris" in v && !validRedirects(v.redirectUris)) errors.push(redirectError);
      const scopes = "scopes" in v ? parseScopes(v.scopes) : undefined;
      if ("scopes" in v && !scopes) errors.push(scopesError);
      if ("enabled" in v && typeof v.enabled !== "boolean") errors.push("enabled: true or false");
      if (errors.length) return problem(res, 400, "invalid_request", errors);
      if (revokeGrants && v.enabled !== false) return problem(res, 400, "invalid_request", ['revokeGrants needs "enabled": false']);
      if (family.clientId === id && (v.enabled === false || (scopes && !scopes.includes(ADMIN_SCOPE))))
        return problem(res, 409, "self_lockout");
      const c = clients.get(id);
      if (!c) return problem(res, 404, "not_found");
      const before = clientJson(c);
      if ("name" in v) c.name = v.name as string;
      if ("redirectUris" in v) c.redirectUris = v.redirectUris as string[];
      if (scopes) c.scopes = scopes;
      if ("enabled" in v) c.enabled = v.enabled as boolean;
      c.updatedBy = user.id;
      c.updatedAt = new Date().toISOString();
      let revoked = 0;
      if (revokeGrants)
        for (const [fid, f] of families)
          if (f.clientId === id && !f.revoked) {
            revokeFamily(fid);
            revoked++;
          }
      record(user.id, "client.update", id, before, clientJson(c));
      return send(res, 200, revokeGrants ? { ...clientJson(c), revokedGrantFamilies: revoked } : clientJson(c));
    }

    return problem(res, 404, "not_found");
  }

  function expireAccess() {
    accessTokens = new Map();
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) problem(res, 500, "server_error");
      else res.end();
    });
  });

  const backend: MockBackend = {
    server,
    url: "",
    close: () => new Promise((resolve) => server.close(() => resolve())),
    reset,
    expireAccess,
    stats,
  };
  return backend;
}

/** Starts the mock on 127.0.0.1 (port 0 = any free port) and resolves once it listens. */
export async function startMockBackend(opts: MockOptions, port = 0): Promise<MockBackend> {
  const backend = createMockBackend(opts);
  await new Promise<void>((resolve) => backend.server.listen(port, "127.0.0.1", resolve));
  const address = backend.server.address();
  backend.url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
  return backend;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.MOCK_PORT ?? 9300);
  const adminOrigin = process.env.MOCK_ADMIN_ORIGIN ?? "http://localhost:5173";
  const accessSeconds = process.env.MOCK_ACCESS_SECONDS ? Number(process.env.MOCK_ACCESS_SECONDS) : undefined;
  const backend = await startMockBackend({ adminOrigin, accessSeconds }, port);
  console.log(`Mock MapRoulette backend on ${backend.url} (admin origin ${adminOrigin})`);
}
