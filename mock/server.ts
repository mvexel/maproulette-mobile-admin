/**
 * A mock of the fork's mobile OAuth provider and admin API, for tests and local development.
 * No network beyond loopback, no dependencies. Response shapes follow the backend's
 * docs/mobile-oauth.md and docs/mobile-admin-api.md (MobileOAuthController,
 * MobileAdminController). Instead of the OSM login, /oauth/mobile/authorize shows a page that
 * lets you sign in as a super-user or as a plain user (who gets access_denied for the admin
 * client). It also mocks the deferred sign-up claim routes the claim page uses (design doc
 * deferred-signup-api.md §3.6, §3.7 and §3.10), with fixed claim tokens in MOCK_CLAIM_TOKENS.
 *
 * Run: node mock/server.ts   (MOCK_PORT=9300, MOCK_ADMIN_ORIGIN=http://localhost:5173,
 *                             MOCK_CLAIM_ORIGIN=http://localhost:5174)
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";


/** The one challenge the mock has results for (GET /api/v2/mobile-admin/challenges/:id/results). */
export const RESULTS_CHALLENGE_ID = 42;
export const RESULTS_CSV =
  "task_id,task_name,element,lon,lat,status,status_name,completed_by,completed_by_osm_id,completed_at,changeset_id,stale_reason,deleted,tags_set,tags_unset,answer:shelter\r\n" +
  "1,node/101,node/101,-111.891,40.7608,1,Fixed,Mapper,456,2026-10-10T17:00:00,9001,,false,shelter=yes,,yes\r\n";
const RESULTS_GEOJSON = {
  type: "FeatureCollection",
  features: [{
    type: "Feature", id: 1, geometry: { type: "Point", coordinates: [-111.891, 40.7608] },
    properties: { taskId: 1, taskName: "node/101", element: "node/101", status: 1, statusName: "Fixed", answers: { shelter: "yes" } },
  }, {
    type: "Feature", id: 2, geometry: { type: "Point", coordinates: [-111.892, 40.7612] },
    properties: { taskId: 2, taskName: "node/102", featureName: null, featureRef: "1234", element: "node/102", status: 6, statusName: "Too hard", completedAt: "2026-10-10T17:05:00", outcome: "not-here", outcomeLabel: "It's not here", reportCount: 2 },
  }, {
    type: "Feature", id: 3, geometry: { type: "Point", coordinates: [-111.8912, 40.7609] },
    properties: { taskId: 3, taskName: "node/103", featureName: "900 E / 1300 S", featureRef: "1235", element: "node/103", status: 6, statusName: "Too hard", completedAt: "2026-10-10T17:10:00", outcome: "moved", outcomeLabel: "It's moved", reportCount: 1 },
  }, {
    type: "Feature", id: "3-reported", geometry: { type: "Point", coordinates: [-111.8912, 40.76091] },
    properties: { kind: "reported_position", taskId: 3, element: "node/103", source: "tap", distanceM: 21 },
  }],
};

export interface MockOptions {
  /** Origin of the admin app, for CORS and the seeded admin client's redirect. */
  adminOrigin: string;
  /** Access token lifetime in seconds (backend default 900). */
  accessSeconds?: number;
  /** Number of audit rows seeded at start and on reset. */
  auditSeed?: number;
  /** Origin of the claim page, for CORS and the seeded claim client's redirect. */
  claimOrigin?: string;
}

/** Fixed claim tokens (43 characters, like the backend's) for each token state. */
export const MOCK_CLAIM_TOKENS = {
  /** Four answers: two published (one with a dropped answer), one changed, one checked first. */
  partial: "mock-claim-partial".padEnd(43, "x"),
  /** Three answers, all published. */
  all: "mock-claim-all".padEnd(43, "x"),
  /** Already claimed by mock-mapper and published. */
  claimed: "mock-claim-claimed".padEnd(43, "x"),
  /** Claimed by mock-mapper; stopped on osm_reauth_required with 1 of 3 published (§3.11). */
  reauth: "mock-claim-reauth".padEnd(43, "x"),
  /** Claimed by mock-mapper; finished with one row failed, so it can be retried (§3.11). */
  failed: "mock-claim-failed".padEnd(43, "x"),
  expired: "mock-claim-expired".padEnd(43, "x"),
  deleted: "mock-claim-deleted".padEnd(43, "x"),
} as const;

/** Fixed live progress page tokens (BACKLOG #12): a live page, an ended one, one turned off. */
export const MOCK_LIVE_TOKENS = {
  live: "mock-live-page".padEnd(43, "x"),
  ended: "mock-live-ended".padEnd(43, "x"),
  off: "mock-live-off".padEnd(43, "x"),
} as const;

/** `GET /api/v2/live/:token` for a few Woodbine entrances; times are relative to now. */
/** A live page's settings for the audit log: everything but the token, which is the link. */
const liveAudit = ({ token: _, ...rest }: { token: string }) => rest;

function livePage(mode: "live" | "ended") {
  const now = Date.now();
  const at = (minutesAgo: number) => new Date(Math.floor((now - minutesAgo * 60000) / 60000) * 60000).toISOString();
  const ended = mode === "ended";
  return {
    campaign: { name: "Woodbine entrances", hashtags: ["#StreetTallyWoodbine"], match: { entrance: "main" } },
    mode,
    answersShown: true,
    generatedAt: new Date(now).toISOString(),
    ...(ended ? { endedAt: at(30) } : {}),
    tally: { checked: 3, total: 5, needsLook: 1, ...(ended ? {} : { people: 1 }) },
    stops: [
      {
        id: 101,
        lon: -111.9068,
        lat: 40.7538,
        state: "checked",
        name: "Granary Live",
        at: at(4),
        answers: [
          { question: "How does this door open?", answer: "Slides sideways" },
          { question: "Does it open by itself?", answer: "Yes, when you walk up" },
        ],
      },
      { id: 102, lon: -111.9071, lat: 40.7536, state: "checked", at: at(42) },
      { id: 103, lon: -111.9064, lat: 40.7533, state: "checked", ref: "B", at: at(130), reported: "Not an entrance" },
      { id: 104, lon: -111.9075, lat: 40.7541, state: "look", at: at(20), reported: "There's no door" },
      { id: 105, lon: -111.906, lat: 40.7529, state: "todo" },
    ],
  };
}

/** `GET /api/v2/review/:token` (Scala's H1a, handback-copy §2), on the live page's token. No guest ids, days only. */
function reviewPlaces() {
  return [
    {
      id: 201,
      osm: { type: "node", id: 9001 },
      lon: -111.9068,
      lat: 40.7538,
      name: "Granary Live",
      state: "open",
      suggestions: [
        { question: "door", prompt: "How does this door open?", answer: "sliding", label: "Slides sideways", tags: { door: "sliding" }, people: 2, day: "2026-10-14", current: { door: null } },
        { question: "automatic_door", prompt: "Does it open by itself?", answer: "motion", label: "Yes, when you walk up", tags: { automatic_door: "motion" }, people: 2, day: "2026-10-14", current: { automatic_door: null } },
      ],
      reports: [],
    },
    {
      id: 202,
      osm: { type: "node", id: 9002 },
      lon: -111.9071,
      lat: 40.7536,
      ref: "B",
      state: "open",
      suggestions: [{ question: "door", prompt: "How does this door open?", answer: "hinged", label: "Swings open", tags: { door: "hinged" }, people: 1, day: "2026-10-14", current: { door: null } }],
      reports: [{ outcome: "no_door", label: "There's no door", people: 1, day: "2026-10-14" }],
    },
    {
      id: 203,
      osm: { type: "node", id: 9003 },
      lon: -111.9064,
      lat: 40.7533,
      state: "open",
      suggestions: [],
      reports: [{ outcome: "moved", label: "It's moved", people: 1, day: "2026-10-14", lon: -111.90625, lat: 40.75338 }],
    },
    {
      id: 204,
      osm: { type: "way", id: 7001 },
      lon: -111.9075,
      lat: 40.7541,
      name: "Woodbine Food Hall",
      state: "done",
      suggestions: [{ question: "door", prompt: "How does this door open?", answer: "revolving", label: "Revolves", tags: { door: "revolving" }, people: 3, day: "2026-10-13", current: { door: "revolving" } }],
      reports: [],
    },
    {
      id: 205,
      osm: { type: "node", id: 9005 },
      lon: -111.906,
      lat: 40.7529,
      state: "open",
      suggestions: [],
      reports: [{ outcome: "not_here", label: "It's not here", people: 1, day: "2026-10-13" }],
    },
    {
      id: 206,
      osm: { type: "node", id: 9006 },
      lon: -111.9055,
      lat: 40.7531,
      name: "Side door",
      state: "disagree",
      suggestions: [
        { question: "door", prompt: "How does this door open?", answer: "sliding", label: "Slides sideways", tags: { door: "sliding" }, people: 1, day: "2026-10-14", current: { door: null } },
        { question: "door", prompt: "How does this door open?", answer: "hinged", label: "Swings open", tags: { door: "hinged" }, people: 1, day: "2026-10-14", current: { door: null } },
      ],
      reports: [],
    },
    {
      id: 207,
      osm: { type: "node", id: 9007 },
      lon: -111.9053,
      lat: 40.7533,
      name: "Loading bay",
      state: "stale",
      suggestions: [{ question: "door", prompt: "How does this door open?", answer: "sliding", label: "Slides sideways", tags: { door: "sliding" }, people: 2, day: "2026-10-13", current: { door: null } }],
      reports: [],
    },
    {
      id: 208,
      osm: { type: "node", id: 9008 },
      lon: -111.9051,
      lat: 40.7535,
      name: "Old annex",
      state: "gone",
      suggestions: [{ question: "door", prompt: "How does this door open?", answer: "hinged", label: "Swings open", tags: { door: "hinged" }, people: 1, day: "2026-10-13", current: { door: null } }],
      reports: [],
    },
  ];
}

interface PendingTask {
  taskId: number;
  lat: number;
  lon: number;
  answeredAt: string;
  label: string;
  answers: { prompt: string; label: string }[];
  /** What the publish job will do with it. */
  outcome: "published" | "skipped_stale" | "superseded" | "failed";
  dropped?: string[];
}

interface Guest {
  state: "active" | "claimed" | "expired" | "deleted";
  expiresAt: string;
  tasks: PendingTask[];
  claimedBy?: number;
  claimId?: number;
  remindersStopped: boolean;
}

interface Claim {
  id: number;
  userId: number;
  guest: Guest;
  state: "queued" | "waiting" | "running" | "reauth_required" | "done" | "partial" | "failed";
  /** Items handled so far; each status poll handles one more. */
  handled: number;
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

// Public campaign texts for the landing page. 8 is the Woodbine pilot (design/woodbine-campaign.md).
const LANDING_CAMPAIGNS: Record<number, { name: string; blurb?: string; description?: string }> = {
  7: {
    name: "SLC Bus Stops",
    blurb: "Help check every bus stop in Salt Lake City for a shelter, a bench, light and wheelchair access.",
  },
  8: {
    name: "Woodbine entrance doors",
    blurb: "Doors around Woodbine Food Hall.",
    description:
      "Help map the doors around Woodbine Food Hall. At each entrance, check how the door opens and whether it opens by itself, so people with wheelchairs, strollers or walkers know what to expect.",
  },
};

const USERS: Record<string, User> = {
  super: { id: 7, osmId: 70007, displayName: "mock-superuser", superUser: true },
  plain: { id: 8, osmId: 80008, displayName: "mock-mapper", superUser: false },
};

const ADMIN_SCOPE = "mobile:admin";
// As MobileScopes.clientScopeSets, in its order (backend docs/mobile-admin-api.md, scope-sets).
const SCOPE_SETS = [
  "tasks:read",
  ADMIN_SCOPE,
  "tasks:read tasks:write",
  "tasks:read guest",
  "tasks:read tasks:write tasks:edit",
  "tasks:read tasks:write osm:tagfix",
  "tasks:read tasks:write guest",
  "tasks:read tasks:write tasks:edit guest",
  "tasks:read tasks:write osm:tagfix guest",
];
const token = () => randomBytes(32).toString("base64url"); // 43 characters, like the backend
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

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

interface MockProject {
  id: number;
  name: string;
  displayName: string | null;
  enabled: boolean;
}
interface MockLivePage {
  challengeId: number;
  token: string;
  enabled: boolean;
  showAnswers: boolean;
  eventStart: string | null;
  endedAt: string | null;
  updatedAt: string;
}
interface MockCampaign {
  id: number;
  name: string;
  projectId: number;
  enabled: boolean;
  published: boolean;
  total: number;
  checked: number;
  needsLook: number;
  modified: string;
  description: string;
  instruction: string;
  checkinComment: string;
  checkinSource: string;
}

export function createMockBackend(opts: MockOptions): MockBackend {
  const adminOrigin = opts.adminOrigin.replace(/\/+$/, "");
  const claimOrigin = opts.claimOrigin?.replace(/\/+$/, "");
  const accessSeconds = opts.accessSeconds ?? 900;

  let clients = new Map<string, Client>();
  let audit: Audit[] = [];
  let writePolicy = false;
  let guests = new Map<string, Guest>();
  let claims = new Map<number, Claim>();
  let nextClaimId = 1;
  let claimWrites = true;
  let projects = new Map<number, MockProject>();
  let campaigns: MockCampaign[] = [];
  /** Live progress pages by challenge id (backend docs/mobile-admin-api.md, "Live progress page"). */
  let livePages = new Map<number, MockLivePage>();
  /** The review page's marks: Needs a visit for everyone, Skip per mapper (user id). */
  let reviewVisits = new Set<number>();
  let reviewSkips = new Map<number, Set<number>>();
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

  function seedGuests() {
    const day = 86_400_000;
    const expiresAt = new Date(Date.now() + 20 * day).toISOString();
    const answeredAt = new Date(Date.now() - 2 * day).toISOString();
    const stop = (taskId: number, lat: number, lon: number, label: string, shelter: string, bench: string): PendingTask => ({
      taskId,
      lat,
      lon,
      answeredAt,
      label,
      answers: [
        { prompt: "Is there a shelter with a roof?", label: shelter },
        { prompt: "Is there a bench or seat?", label: bench },
      ],
      outcome: "published",
    });
    const four = [
      stop(101, 40.7608, -111.891, "400 S & Main", "No", "Yes"),
      { ...stop(102, 40.7621, -111.8882, "300 S & State", "No", "No"), dropped: ["bench"] },
      { ...stop(103, 40.7645, -111.8905, "Stop 13042", "Yes", "Yes"), outcome: "skipped_stale" as const },
      { ...stop(104, 40.7587, -111.8861, "500 S & 200 E", "No", "Yes"), outcome: "superseded" as const },
    ];
    claims = new Map();
    const three = (outcome: PendingTask["outcome"]) =>
      [stop(111, 40.7602, -111.8851, "400 S & 200 E", "No", "No"), stop(112, 40.7633, -111.8871, "300 S & 100 E", "Yes", "No"), stop(113, 40.7655, -111.8889, "200 S & State", "No", "Yes")].map(
        (t, i) => ({ ...t, outcome: i === 2 ? outcome : ("published" as const) }),
      );
    const stopped = (tasks: PendingTask[], state: Claim["state"], handled: number): Guest => {
      const g: Guest = { state: "claimed", expiresAt, tasks, claimedBy: USERS.plain.id, remindersStopped: false };
      const c: Claim = { id: nextClaimId++, userId: USERS.plain.id, guest: g, state, handled };
      claims.set(c.id, c);
      g.claimId = c.id;
      return g;
    };
    guests = new Map([
      [MOCK_CLAIM_TOKENS.reauth, stopped(three("published"), "reauth_required", 1)],
      [MOCK_CLAIM_TOKENS.failed, stopped(three("failed"), "failed", 3)],
      [MOCK_CLAIM_TOKENS.partial, { state: "active", expiresAt, tasks: four, remindersStopped: false }],
      [MOCK_CLAIM_TOKENS.all, { state: "active", expiresAt, tasks: four.slice(0, 2).concat(stop(105, 40.7667, -111.8835, "200 S & 300 E", "Yes", "No")).map((t) => ({ ...t, outcome: "published" as const, dropped: undefined })), remindersStopped: false }],
      [MOCK_CLAIM_TOKENS.claimed, { state: "claimed", expiresAt, tasks: four.slice(0, 1), claimedBy: USERS.plain.id, remindersStopped: false }],
      [MOCK_CLAIM_TOKENS.expired, { state: "expired", expiresAt: new Date(Date.now() - day).toISOString(), tasks: [], remindersStopped: false }],
      [MOCK_CLAIM_TOKENS.deleted, { state: "deleted", expiresAt, tasks: [], remindersStopped: false }],
    ]);
    claimWrites = true;
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
    if (claimOrigin)
      seedClient({
        id: "maproulette-claim",
        name: "Street Tally claim page",
        redirectUris: [`${claimOrigin}/claim/callback`],
        scopes: ["tasks:read", "tasks:write", "osm:tagfix"],
      });
    if (claimOrigin)
      seedClient({
        id: "street-tally-review",
        name: "Street Tally review page",
        redirectUris: [`${claimOrigin}/review/callback`],
        scopes: ["tasks:read"],
      });
    seedGuests();
    audit = [];
    writePolicy = false;
    livePages = new Map();
    reviewVisits = new Set();
    reviewSkips = new Map();
    projects = new Map([
      [1, { id: 1, name: "SLC test", displayName: null, enabled: false }],
      [2, { id: 2, name: "Street Tally pilots", displayName: "Street Tally pilots", enabled: true }],
    ]);
    campaigns = [
      { id: 3, name: "Street Tally test: 1300 S 900 E bus stops", projectId: 1, enabled: true, published: true, total: 28, checked: 12, needsLook: 2, modified: "2026-10-11T02:30:00Z", description: "Check what each bus stop has: a bench, a shelter, a bin.", instruction: "Stand at the stop and answer what you can see.", checkinComment: "Bus stop survey #StreetTally", checkinSource: "survey" },
      { id: 7, name: "SLC Bus Stops", projectId: 2, enabled: true, published: true, total: 410, checked: 128, needsLook: 9, modified: "2026-10-10T18:00:00Z", description: "Check what each bus stop has: a bench, a shelter, a bin.", instruction: "Stand at the stop and answer what you can see.", checkinComment: "Bus stop survey #StreetTally", checkinSource: "survey" },
      { id: 9, name: "Restaurant check (draft)", projectId: 2, enabled: false, published: false, total: 5, checked: 0, needsLook: 0, modified: "2026-10-09T12:00:00Z", description: "Takes about 2 minutes per stop. More at https://example.org", instruction: "Visit the restaurant and answer what you can confirm.", checkinComment: "Restaurant survey", checkinSource: "local knowledge" },
    ];
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
    'scopes: ["tasks:read"], ["tasks:read","tasks:write"], ["tasks:read","tasks:write","osm:tagfix"], ["tasks:read","tasks:write","tasks:edit"] or ["mobile:admin"]; app scopes may add "guest"';

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
    const order = ["tasks:read", "tasks:write", "tasks:edit", "osm:tagfix", ADMIN_SCOPE, "guest"];
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

  const oauthPaths = ["/oauth/mobile/token", "/oauth/mobile/revoke", "/oauth/mobile/me"];
  const adminPaths = (path: string) =>
    path.startsWith("/api/v2/mobile-admin/") || /^\/api\/v2\/challenge\/[0-9]+$/.test(path) || oauthPaths.includes(path);
  // deferred-signup-api.md §5 and §3.10: the claim origin gets the OAuth and claim routes only.
  const claimPaths = (path: string) =>
    oauthPaths.includes(path) ||
    /^\/api\/v2\/mobile-claim(\/preview|\/delete|\/stop-reminders|\/[0-9]+|\/[0-9]+\/retry)?$/.test(path) ||
    // The live progress page's public read (BACKLOG #12).
    /^\/api\/v2\/live\/[A-Za-z0-9_-]{43}$/.test(path) ||
    // The review page (handback-copy §2): the read and the two marks.
    /^\/api\/v2\/review\/[A-Za-z0-9_-]{43}(\/places\/[0-9]+\/(skip|needs-visit))?$/.test(path) ||
    // The campaign landing page reads the public challenge (name, blurb); §3.11 CORS.
    /^\/api\/v2\/challenge\/[0-9]+$/.test(path);

  /** MobileCorsFilter: the admin and claim origins only, no credentials; other preflights get 403. */
  function cors(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    const origin = req.headers.origin;
    if (!origin || !(adminPaths(path) || claimPaths(path))) return false;
    const allowed = (origin === adminOrigin && adminPaths(path)) || (origin === claimOrigin && claimPaths(path));
    if (!allowed) {
      if (req.method === "OPTIONS") {
        send(res, 403);
        return true;
      }
      return false;
    }
    res.setHeader("Access-Control-Allow-Origin", origin);
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
    // A MapLibre style with no tiles, so map pages can be checked without the network.
    if (path === "/__mock/style.json" && req.method === "GET")
      return send(res, 200, { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#ECEBE5" } }] }, { "Access-Control-Allow-Origin": "*" });
    if (path === "/__mock/claim-writes" && req.method === "POST") {
      claimWrites = q.get("enabled") === "true";
      return send(res, 204);
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
      // `guest` is a client capability, never part of a grant.
      if (q.get("scope") !== client.scopes.filter((s) => s !== "guest").join(" ")) return problem(res, 400, "invalid_scope");
      const tx = token();
      interactions.set(tx, { clientId: client.id, redirectUri, state: q.get("state")!, challenge: q.get("code_challenge")! });
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(`<!doctype html><title>Mock sign-in</title><h1>Mock MapRoulette sign-in</h1>
<p>Client <code>${client.id}</code> asks for <code>${client.scopes.join(" ")}</code>. This mock replaces the OSM login and consent.</p>
<p><a href="/oauth/mobile/authorize/decide?tx=${tx}&as=super">Sign in as ${USERS.super.displayName} (super-user)</a></p>
<p><a href="/oauth/mobile/authorize/decide?tx=${tx}&as=plain">Sign in as ${USERS.plain.displayName} (not a super-user)</a></p>
<p><a href="/oauth/mobile/authorize/decide?tx=${tx}&as=cancel">Cancel</a></p>`);
      return;
    }

    if (path === "/oauth/mobile/authorize/decide" && req.method === "GET") {
      const i = interactions.get(q.get("tx") ?? "");
      if (i && q.get("as") === "cancel") {
        interactions.delete(q.get("tx")!);
        return appRedirect(res, i.redirectUri, { error: "access_denied", state: i.state });
      }
      const user = USERS[q.get("as") ?? ""];
      if (!i || !user) return problem(res, 400, "invalid_request");
      interactions.delete(q.get("tx")!);
      if (!user.superUser && clients.get(i.clientId)?.scopes.includes(ADMIN_SCOPE))
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
        families.set(familyId, { userId: code.userId, clientId: client.id, scope: client.scopes.join(" "), revoked: false, refresh: "", used: new Set() });
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

    if (path.startsWith("/api/v2/mobile-claim")) return claim(req, res, path);

    // The live progress page: public, by token; 404 not_found or turned_off otherwise.
    const live = /^\/api\/v2\/live\/([A-Za-z0-9_-]{43})$/.exec(path);
    if (live && req.method === "GET") {
      const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
      if (live[1] === MOCK_LIVE_TOKENS.live) return send(res, 200, livePage("live"), headers);
      if (live[1] === MOCK_LIVE_TOKENS.ended) return send(res, 200, livePage("ended"), headers);
      // A page made in the admin shows the same fixture stops, as its settings say.
      const made = [...livePages.values()].find((p) => p.token === live[1]);
      if (made && !made.enabled) return send(res, 404, { error: "turned_off" }, headers);
      if (made) {
        const page = livePage(made.endedAt ? "ended" : "live");
        return send(res, 200, { ...page, answersShown: made.showAnswers, ...(made.endedAt ? { endedAt: made.endedAt } : {}) }, headers);
      }
      return send(res, 404, { error: live[1] === MOCK_LIVE_TOKENS.off ? "turned_off" : "not_found" }, headers);
    }

    // The review page (H1a, backend/h1/h1a-api.md): public read by the live token; marks need a bearer.
    // One page of results here; the real API pages with after/limit and `next`.
    const review = /^\/api\/v2\/review\/([A-Za-z0-9_-]{43})(?:\/places\/([0-9]+)\/(skip|needs-visit))?$/.exec(path);
    if (review) {
      const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
      if (review[1] !== MOCK_LIVE_TOKENS.live) return send(res, 404, { error: review[1] === MOCK_LIVE_TOKENS.off ? "turned_off" : "not_found" }, headers);
      const b = req.headers.authorization ? bearer(req) : undefined;
      if (req.headers.authorization && !b) return problem(res, 401, "sign_in_required");
      const mine = b ? (reviewSkips.get(b.user.id) ?? new Set<number>()) : new Set<number>();
      const view = () =>
        reviewPlaces().map((p) => ({
          ...p,
          state: p.state === "done" ? "done" : reviewVisits.has(p.id) || p.id === 205 ? "needs_visit" : p.state === "needs_visit" ? "open" : p.state,
          ...(b ? { skipped: mine.has(p.id) } : {}),
        }));
      if (!review[2] && req.method === "GET") {
        const places = view();
        return send(
          res,
          200,
          {
            campaign: { name: "Woodbine entrance doors", hashtags: ["#StreetTallyWoodbine"], match: { entrance: "main" } },
            counts: {
              toReview: places.filter((p) => p.state === "open").reduce((n, p) => n + p.suggestions.length, 0),
              added: places.filter((p) => p.state === "done").length,
              needsVisit: places.filter((p) => p.state === "needs_visit").length,
              stale: places.filter((p) => p.state === "stale").length,
              gone: places.filter((p) => p.state === "gone").length,
              disagree: places.filter((p) => p.state === "disagree").length,
            },
            places,
          },
          headers,
        );
      }
      if (review[2] && (req.method === "PUT" || req.method === "DELETE")) {
        if (!b) return problem(res, 401, "sign_in_required");
        const id = Number(review[2]);
        const found = reviewPlaces().find((p) => p.id === id);
        if (!found) return problem(res, 404, "not_found");
        if (review[3] === "needs-visit" && req.method === "PUT" && found.state === "done") return problem(res, 409, "done");
        const on = req.method === "PUT";
        if (review[3] === "skip") {
          if (on) mine.add(id);
          else mine.delete(id);
          reviewSkips.set(b.user.id, mine);
        } else if (on) reviewVisits.add(id);
        else reviewVisits.delete(id);
        return send(res, 200, view().find((p) => p.id === id), headers);
      }
      return problem(res, 405, "method_not_allowed");
    }

    // The campaign landing page reads the public challenge (name, description) without a token.
    const landing = /^\/api\/v2\/challenge\/([0-9]+)$/.exec(path);
    if (landing && req.method === "GET" && !req.headers.authorization) {
      const campaign = LANDING_CAMPAIGNS[Number(landing[1])];
      if (!campaign) return problem(res, 404, "not_found");
      return send(res, 200, { id: Number(landing[1]), ...campaign });
    }

    // The stock challenge read and publish, as an admin grant reaches them (docs/mobile-admin-api.md).
    const cm = /^\/api\/v2\/challenge\/([0-9]+)$/.exec(path);
    if (cm && (req.method === "GET" || req.method === "PUT")) {
      const b = bearer(req);
      if (!b) return problem(res, 401, "invalid_token");
      if (b.family.scope !== ADMIN_SCOPE || !b.user.superUser) return problem(res, 403, "insufficient_scope");
      const c = campaigns.find((x) => x.id === Number(cm[1]));
      if (!c) return problem(res, 404, "not_found");
      if (req.method === "PUT") {
        const v = JSON.parse((await readBody(req)) || "{}") as { enabled?: boolean; tags?: string[] };
        if (typeof v.enabled === "boolean") c.enabled = v.enabled;
        if (v.tags?.includes("mobile-survey-v1")) c.published = true;
        c.modified = new Date().toISOString();
        record(b.user.id, "stock.PUT", path, null, { status: 200 });
      }
      const { id, name, enabled, projectId, description, instruction, checkinComment, checkinSource } = c;
      return send(res, 200, { id, name, enabled, parent: projectId, description, instruction, checkinComment, checkinSource });
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


  // --- deferred sign-up claim routes (deferred-signup-api.md §3.6, §3.7, §3.10) ------------------

  async function claimToken(req: IncomingMessage): Promise<string | undefined> {
    try {
      const v = JSON.parse(await readBody(req)) as { claimToken?: unknown };
      return typeof v.claimToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(v.claimToken) ? v.claimToken : undefined;
    } catch {
      return undefined;
    }
  }

  function preview(g: Guest) {
    const tasks = g.state === "active" ? g.tasks : [];
    const counts = (prompt: string) => {
      const c: Record<string, number> = {};
      for (const t of tasks) {
        const a = t.answers.find((x) => x.prompt === prompt);
        if (a) c[a.label.toLowerCase()] = (c[a.label.toLowerCase()] ?? 0) + 1;
      }
      return c;
    };
    return {
      state: g.state,
      expiresAt: g.expiresAt,
      pending: tasks.length,
      challenges: [{ id: 7, name: "SLC Bus Stops", pending: tasks.length }],
      tasks: tasks.map((t) => ({ taskId: t.taskId, lat: t.lat, lon: t.lon, answeredAt: t.answeredAt, label: t.label, answers: t.answers })),
      summary: [
        { questionId: "shelter", label: "Shelter", counts: counts("Is there a shelter with a roof?") },
        { questionId: "bench", label: "Bench", counts: counts("Is there a bench or seat?") },
      ],
      writesEnabled: claimWrites,
      campaign: {
        challengeId: 7,
        name: "SLC Bus Stops",
        noun: { one: "stop", other: "stops" },
        hashtag: "#StreetTallySLCStops",
        wikiUrl: "https://wiki.openstreetmap.org/wiki/Organised_Editing/Activities/Street_Tally_SLC_Bus_Stops",
        organizerName: "Salt Lake Transit Riders",
        eventDate: "2026-11-08",
      },
      tally: { checked: 212, total: 410 },
      found: [
        { questionId: "shelter", prompt: "Is there a shelter with a roof?", noCount: counts("Is there a shelter with a roof?").no ?? 0 },
        { questionId: "bench", prompt: "Is there a bench or seat?", noCount: counts("Is there a bench or seat?").no ?? 0 },
      ].filter((f) => f.noCount > 0),
      claim: claimOf(g),
    };
  }

  /** The preview's view of a claimed token's claim (§3.11), without advancing it. */
  function claimOf(g: Guest) {
    const c = g.claimId === undefined ? undefined : claims.get(g.claimId);
    if (g.state !== "claimed") return null;
    const user = Object.values(USERS).find((u) => u.id === g.claimedBy)!;
    const items = g.tasks.slice(0, c?.handled ?? g.tasks.length);
    const n = (o: string) => items.filter((t) => t.outcome === o).length;
    return {
      state: c?.state ?? "done",
      claimedAs: { displayName: user.displayName },
      counts: {
        total: g.tasks.length,
        published: n("published"),
        pending: g.tasks.length - items.length,
        skipped: n("skipped_stale"),
        superseded: n("superseded"),
        failed: n("failed"),
      },
    };
  }

  /** A claim's 3.7 status. Each poll moves it on one step, unless `advance` is false. */
  function status(c: Claim, advance = true) {
    if (advance) {
      if (c.state === "waiting" && claimWrites) c.state = "running";
      if (c.state === "queued") c.state = "running";
      else if (c.state === "running") c.handled = Math.min(c.handled + 1, c.guest.tasks.length);
    }
    const items = c.guest.tasks.slice(0, c.handled).map((t) => ({
      taskId: t.taskId,
      state: t.outcome,
      ...(t.outcome === "published" ? { changesetId: 9_000_000 + t.taskId } : {}),
      dropped: t.dropped ?? [],
    }));
    if (c.state === "running" && c.handled === c.guest.tasks.length)
      c.state = items.some((i) => i.state === "failed") ? "failed" : items.every((i) => i.state === "published" && !i.dropped.length) ? "done" : "partial";
    const n = (s: string) => items.filter((i) => i.state === s).length;
    return {
      claimId: c.id,
      state: c.state,
      total: c.guest.tasks.length,
      published: n("published"),
      skipped: n("skipped_stale"),
      superseded: n("superseded"),
      failed: n("failed"),
      items,
    };
  }

  async function claim(req: IncomingMessage, res: ServerResponse, path: string) {
    if (path === "/api/v2/mobile-claim/preview" && req.method === "POST") {
      const t = await claimToken(req);
      if (!t) return problem(res, 400, "invalid_request");
      const g = guests.get(t);
      return g ? send(res, 200, preview(g)) : problem(res, 404, "not_found");
    }
    if ((path === "/api/v2/mobile-claim/delete" || path === "/api/v2/mobile-claim/stop-reminders") && req.method === "POST") {
      const t = await claimToken(req);
      if (!t) return problem(res, 400, "invalid_request");
      const g = guests.get(t);
      if (g?.state !== "active") return problem(res, 404, "not_found");
      if (path.endsWith("/delete")) {
        g.state = "deleted";
        g.tasks = [];
      } else g.remindersStopped = true;
      return send(res, 204);
    }
    if (path === "/api/v2/mobile-claim" && req.method === "POST") {
      const b = bearer(req);
      if (!b) return problem(res, 401, "invalid_token");
      if (!b.family.scope.includes("tasks:write") || !b.family.scope.includes("osm:tagfix"))
        return problem(res, 403, "insufficient_scope");
      const t = await claimToken(req);
      if (!t) return problem(res, 400, "invalid_request");
      const g = guests.get(t);
      if (!g || g.state === "expired" || g.state === "deleted") return problem(res, 404, "not_found");
      const user = { displayName: b.user.displayName, osmId: b.user.osmId };
      if (g.state === "claimed") {
        if (g.claimedBy !== b.user.id) {
          const other = Object.values(USERS).find((u) => u.id === g.claimedBy)!;
          return send(res, 409, { error: "guest_claimed", claimedAs: { displayName: other.displayName, osmId: other.osmId } });
        }
        if (g.claimId === undefined) {
          // Claimed before the mock started (fixture): a finished claim for that user.
          const done: Claim = { id: nextClaimId++, userId: b.user.id, guest: g, state: "done", handled: g.tasks.length };
          claims.set(done.id, done);
          g.claimId = done.id;
        }
        const c = claims.get(g.claimId)!;
        return send(res, 200, { claimId: c.id, state: c.state, pending: g.tasks.length, user });
      }
      const c: Claim = { id: nextClaimId++, userId: b.user.id, guest: g, state: claimWrites ? "queued" : "waiting", handled: 0 };
      claims.set(c.id, c);
      g.state = "claimed";
      g.claimedBy = b.user.id;
      g.claimId = c.id;
      return send(res, 202, { claimId: c.id, state: c.state, pending: g.tasks.length, user });
    }
    const r = /^\/api\/v2\/mobile-claim\/([0-9]+)\/retry$/.exec(path);
    if (r && req.method === "POST") {
      const b = bearer(req);
      if (!b) return problem(res, 401, "invalid_token");
      const c = claims.get(Number(r[1]));
      if (!c || c.userId !== b.user.id) return problem(res, 404, "not_found");
      // Failed rows go back to pending; the mock lets them succeed this time.
      const retried = c.guest.tasks.filter((t) => t.outcome === "failed").length;
      const stopped = c.state === "reauth_required";
      for (const t of c.guest.tasks) if (t.outcome === "failed") t.outcome = "published";
      if (retried || stopped) {
        c.state = claimWrites ? "queued" : "waiting";
        c.handled = stopped ? c.handled : c.handled - retried;
      }
      return send(res, 202, { ...status(c, false), retried });
    }
    const m = /^\/api\/v2\/mobile-claim\/([0-9]+)$/.exec(path);
    if (m && req.method === "GET") {
      const b = bearer(req);
      if (!b) return problem(res, 401, "invalid_token");
      const c = claims.get(Number(m[1]));
      if (!c || c.userId !== b.user.id) return problem(res, 404, "not_found");
      return send(res, 200, status(c));
    }
    return problem(res, 404, "not_found");
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

  const projectJson = (p: MockProject) => {
    const own = campaigns.filter((c) => c.projectId === p.id);
    return { ...p, campaigns: own.length, published: own.filter((c) => c.enabled && c.published).length };
  };
  const campaignJson = (c: MockCampaign) => {
    const p = projects.get(c.projectId)!;
    return {
      id: c.id,
      name: c.name,
      enabled: c.enabled,
      published: c.published,
      listed: c.enabled && c.published && p.enabled,
      modified: c.modified,
      project: { id: p.id, name: p.name, displayName: p.displayName, enabled: p.enabled },
      tasks: { total: c.total, checked: c.checked, needsLook: c.needsLook },
    };
  };

  async function admin(req: IncomingMessage, res: ServerResponse, path: string, q: URLSearchParams, user: User, family: Family) {
    const results = /^\/api\/v2\/mobile-admin\/challenges\/([0-9]+)\/results$/.exec(path);
    if (results && req.method === "GET") {
      const format = q.get("format") ?? "csv";
      if (format !== "csv" && format !== "geojson")
        return problem(res, 400, "invalid_request", ["format must be csv or geojson"]);
      // The campaigns have results with no reports yet.
      const campaign = campaigns.some((c) => String(c.id) === results[1]);
      if (results[1] !== String(RESULTS_CHALLENGE_ID) && !campaign) return problem(res, 404, "not_found");
      const full = results[1] === String(RESULTS_CHALLENGE_ID);
      const disposition = { "Content-Disposition": `attachment; filename="challenge-${results[1]}-results.${format}"` };
      if (format === "geojson") {
        res.writeHead(200, { "Content-Type": "application/geo+json", "Cache-Control": "no-store", ...disposition });
        return res.end(JSON.stringify(full ? RESULTS_GEOJSON : { type: "FeatureCollection", features: [] }));
      }
      res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", ...disposition });
      return res.end(full ? RESULTS_CSV : `${RESULTS_CSV.split("\r\n")[0]}\r\n`);
    }
    if (path === "/api/v2/mobile-admin/write-policy" && req.method === "GET")
      return send(res, 200, { enabled: writePolicy, managed: true });
    const lp = /^\/api\/v2\/mobile-admin\/challenges\/([0-9]+)\/live(\/rotate)?$/.exec(path);
    const liveId = Number(lp?.[1]);
    const liveExists = () => campaigns.some((c) => c.id === liveId);
    if (lp && !lp[2] && req.method === "GET") {
      const p = livePages.get(liveId);
      if (p) return send(res, 200, p);
      return problem(res, 404, liveExists() ? "no_live_page" : "not_found");
    }
    if (lp?.[2] && req.method === "POST") {
      const p = livePages.get(liveId);
      if (!p) return problem(res, 404, "no_live_page");
      p.token = token();
      p.updatedAt = new Date().toISOString();
      record(user.id, "live.rotate", `challenge:${liveId}`, undefined, liveAudit(p));
      return send(res, 200, p);
    }
    if (path === "/api/v2/mobile-admin/scope-sets" && req.method === "GET")
      return send(res, 200, { scopeSets: SCOPE_SETS.map((s) => s.split(" ")) });
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

    if (path === "/api/v2/mobile-admin/projects" && req.method === "GET")
      return send(res, 200, { projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)).map(projectJson) });
    if (path === "/api/v2/mobile-admin/campaigns" && req.method === "GET")
      return send(res, 200, { campaigns: campaigns.map(campaignJson) });

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

    if (lp && !lp[2] && req.method === "PUT") {
      const v = checkFields(body, ["enabled", "showAnswers", "eventStart", "ended"]);
      if (Array.isArray(v)) return problem(res, 400, "invalid_request", v);
      const errors = (["enabled", "showAnswers", "ended"] as const).filter((f) => f in v && typeof v[f] !== "boolean").map((f) => `${f} must be a boolean`);
      if ("eventStart" in v && v.eventStart !== null && (typeof v.eventStart !== "string" || Number.isNaN(Date.parse(v.eventStart))))
        errors.push("eventStart must be an ISO 8601 instant or null");
      if (errors.length) return problem(res, 400, "invalid_request", errors);
      if (!liveExists()) return problem(res, 404, "not_found");
      const now = new Date().toISOString();
      const before = livePages.get(liveId);
      const p: MockLivePage = before ?? { challengeId: liveId, token: token(), enabled: true, showAnswers: false, eventStart: null, endedAt: null, updatedAt: now };
      if ("enabled" in v) p.enabled = v.enabled as boolean;
      if ("showAnswers" in v) p.showAnswers = v.showAnswers as boolean;
      if ("eventStart" in v) p.eventStart = v.eventStart === null ? null : new Date(v.eventStart as string).toISOString();
      if (v.ended === true) p.endedAt ??= now;
      if (v.ended === false) p.endedAt = null;
      p.updatedAt = now;
      livePages.set(liveId, p);
      record(user.id, before ? "live.update" : "live.create", `challenge:${liveId}`, undefined, liveAudit(p));
      return send(res, 200, p);
    }

    if (path === "/api/v2/mobile-admin/projects" && req.method === "POST") {
      const v = checkFields(body, ["name", "displayName"]);
      if (Array.isArray(v)) return problem(res, 400, "invalid_request", v);
      const errors: string[] = [];
      if (!validName(v.name)) errors.push(nameError);
      if ("displayName" in v && !validName(v.displayName)) errors.push("displayName: 1 to 200 characters");
      if (errors.length) return problem(res, 400, "invalid_request", errors);
      const name = v.name as string;
      if ([...projects.values()].some((p) => p.name.toLowerCase() === name.toLowerCase())) return problem(res, 409, "project_exists");
      const p: MockProject = { id: Math.max(0, ...projects.keys()) + 1, name, displayName: (v.displayName as string) ?? null, enabled: true };
      projects.set(p.id, p);
      record(user.id, "project.create", `project:${p.id}`, undefined, projectJson(p));
      return send(res, 201, projectJson(p));
    }
    const pm = /^\/api\/v2\/mobile-admin\/projects\/([0-9]+)\/enabled$/.exec(path);
    if (pm && req.method === "PUT") {
      const v = checkFields(body, ["enabled"]);
      if (Array.isArray(v) || typeof v.enabled !== "boolean") return problem(res, 400, "invalid_request", ["expected only enabled"]);
      const p = projects.get(Number(pm[1]));
      if (!p) return problem(res, 404, "not_found");
      if (p.enabled !== v.enabled) {
        p.enabled = v.enabled;
        record(user.id, p.enabled ? "project.enable" : "project.disable", `project:${p.id}`, undefined, projectJson(p));
      }
      return send(res, 200, projectJson(p));
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
  const claimOrigin = process.env.MOCK_CLAIM_ORIGIN ?? "http://localhost:5174";
  const accessSeconds = process.env.MOCK_ACCESS_SECONDS ? Number(process.env.MOCK_ACCESS_SECONDS) : undefined;
  const backend = await startMockBackend({ adminOrigin, claimOrigin, accessSeconds }, port);
  console.log(`Mock MapRoulette backend on ${backend.url} (admin origin ${adminOrigin}, claim origin ${claimOrigin})`);
}
