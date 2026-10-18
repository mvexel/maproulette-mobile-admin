import { AuthError, accessToken, clearSession, role } from "./auth";
import { config } from "./config";

/** An error response from the backend: `{"error": code, "detail"?: [...]}`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string[];

  constructor(status: number, code: string, detail: string[] = []) {
    super(detail.length ? `${code}: ${detail.join("; ")}` : code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/**
 * Calls the backend with the bearer token. A 401 gets one refresh and one retry; a second 401
 * ends the session.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authorized(path, init);
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) throw errorFrom(res, body);
  return body as T;
}

function errorFrom(res: Response, body: unknown): ApiError {
  const b = (body ?? {}) as { error?: string; detail?: string[] };
  return new ApiError(res.status, b.error ?? `http_${res.status}`, b.detail);
}

async function authorized(path: string, init: RequestInit): Promise<Response> {
  const send = async (token: string) =>
    fetch(`${config().backend}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
  let res = await send(await accessToken());
  if (res.status === 401) res = await send(await accessToken(true));
  if (res.status === 401) {
    clearSession();
    throw new AuthError("Session expired. Please sign in again.");
  }
  return res;
}

export interface Client {
  id: string;
  name: string;
  redirectUris: string[];
  scopes: string[];
  enabled: boolean;
  source: "config" | "admin";
  createdBy: number | null;
  updatedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ClientInput = Pick<Client, "id" | "name" | "redirectUris" | "scopes" | "enabled">;
/** POST and PATCH answer with the client fields only (no source or timestamps). */
export type ClientResult = ClientInput & { revokedGrantFamilies?: number };

export const listClients = () => api<{ clients: Client[] }>("/api/v2/mobile-admin/clients").then((r) => r.clients);
/** Every scope set a client may hold, from the backend's scope rules. */
export const listScopeSets = () =>
  api<{ scopeSets: string[][] }>("/api/v2/mobile-admin/scope-sets").then((r) => r.scopeSets);
export const createClient = (c: ClientInput) =>
  api<ClientResult>("/api/v2/mobile-admin/clients", { method: "POST", body: JSON.stringify(c) });
export const updateClient = (id: string, patch: Partial<Omit<ClientInput, "id">>, revokeGrants = false) =>
  api<ClientResult>(`/api/v2/mobile-admin/clients/${encodeURIComponent(id)}${revokeGrants ? "?revokeGrants=true" : ""}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

export interface AuditEntry {
  id: number;
  actorUserId: number;
  action: string;
  target: string;
  /** Absent when there is nothing to show (for example `before` on a create). */
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface AuditPage {
  items: AuditEntry[];
  page: number;
  limit: number;
  total: number;
}

export const listAudit = (page: number, limit = 25) =>
  api<AuditPage>(`/api/v2/mobile-admin/audit?${new URLSearchParams({ limit: String(limit), page: String(page) })}`);

export interface WritePolicy {
  enabled: boolean;
  managed: boolean;
}

const writePolicyListeners = new Set<(policy: WritePolicy) => void>();

/** Calls `listener` with the policy after every successful change; returns the unsubscribe. */
export function onWritePolicyChange(listener: (policy: WritePolicy) => void): () => void {
  writePolicyListeners.add(listener);
  return () => void writePolicyListeners.delete(listener);
}

export const getWritePolicy = () => api<WritePolicy>("/api/v2/mobile-admin/write-policy");
export const setWritePolicy = (enabled: boolean) =>
  api<WritePolicy>("/api/v2/mobile-admin/write-policy", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  }).then((policy) => {
    for (const listener of writePolicyListeners) listener(policy);
    return policy;
  });

export interface Me {
  id: number;
  osmId: number;
  displayName: string;
  scope: string;
}
export const me = () => api<Me>("/oauth/mobile/me");

export interface ChallengeDraft {
  name: string;
  description: string;
  instruction: string;
  checkinComment: string;
  checkinSource: string;
}

export const createChallenge = (draft: ChallengeDraft) =>
  api<{ id: number }>("/api/v2/challenge", { method: "POST", body: JSON.stringify(draft) });

/** Keep new surveys out of discovery until their complete import has been reviewed. */
export const createSurveyChallenge = (draft: ChallengeDraft, projectId: number) =>
  api<{ id: number }>("/api/v2/challenge", {
    method: "POST", body: JSON.stringify({ ...draft, parent: projectId, enabled: false, requiresLocal: true }),
  });

export const publishSurveyChallenge = (id: number) =>
  api<unknown>(`/api/v2/challenge/${id}`, {
    method: "PUT", body: JSON.stringify({ enabled: true, tags: ["mobile-survey-v1"] }),
  });

export interface TaskImportReport {
  created: number;
  updated: number;
  rejected: { line: number; errors: string[] }[];
}

export const importChallengeTasks = (challengeId: number, file: File) => {
  const body = new FormData();
  body.append("json", file);
  return api<TaskImportReport>(`/api/v2/challenge/${challengeId}/addFileTasks?lineByLine=true&report=true`, {
    method: "PUT",
    body,
  });
};

/** A user-facing message for an admin API error. */
export function describeError(e: unknown): { message: string; detail: string[] } {
  if (!(e instanceof ApiError)) return { message: e instanceof Error ? e.message : String(e), detail: [] };
  switch (e.code) {
    case "self_lockout":
      return {
        message:
          "Refused: this would lock the admin app out. It can't disable its own client or remove mobile:admin from it. Use another admin client, or SQL on the backend.",
        detail: [],
      };
    case "invalid_request":
      return { message: "The backend rejected the input:", detail: e.detail };
    case "client_exists":
      return { message: "A client with this ID already exists.", detail: [] };
    case "not_found":
      return { message: "Not found. It may have been removed; reload the list.", detail: [] };
    case "admin_required":
      return { message: "Your account is no longer a MapRoulette super-user.", detail: [] };
    case "organizer_required":
      return { message: "Your account is no longer set up to run campaigns.", detail: [] };
    case "insufficient_scope":
      return role() === "organizer"
        ? { message: "Only the Street Tally team can do this.", detail: [] }
        : { message: `Request failed: ${e.message} (HTTP ${e.status})`, detail: [] };
    case "organizer_forbidden":
      return { message: "This campaign or project isn't one of yours.", detail: [] };
    case "user_not_found":
      return { message: "No one with that OpenStreetMap username has signed in to MapRoulette yet. Ask them to sign in once, then try again.", detail: [] };
    case "project_not_found":
      return { message: "That project doesn't exist any more. Reload the list.", detail: [] };
    case "last_project_admin":
      return { message: "They're this project's only administrator, so they can't be removed or changed to Write. Make someone else an administrator of the project first.", detail: [] };
    case "mobile_writes_disabled":
      // Super-users are the Street Tally team, so they're told where the switch is.
      return {
        message: `Saving is off on this server, so changes can't be saved right now. ${role() === "admin" ? "Turn it on under Task writes." : "Ask the Street Tally team to turn it on."}`,
        detail: [],
      };
    case "nothing_to_check":
      return { message: "There's nothing left to check in this area. Put some places back, or pick a bigger area.", detail: [] };
    case "rate_limited":
      return { message: "Too many tries in a row. Wait a minute and try again.", detail: [] };
    case "area_too_big":
      return { message: "That area has more than 2,000 places to check. Make it smaller.", detail: [] };
    case "osm_unavailable":
      return { message: "OpenStreetMap data isn't reachable right now. Try again in a few minutes.", detail: [] };
    case "osm_timeout":
      return { message: "OpenStreetMap took too long to answer. Try a smaller area, or try again in a few minutes.", detail: [] };
    case "request_open":
      return { message: "You've already asked. The Street Tally team will look at it.", detail: [] };
    case "too_soon":
      return { message: "You can ask again 30 days after the last answer.", detail: [] };
    case "already_organizer":
      return { message: "You're already set up. Sign in again to start a campaign.", detail: [] };
    case "requests_closed":
      return { message: "We aren't taking requests right now. Email martijn@osm.lol to ask.", detail: [] };
    case "request_decided":
      return { message: "Someone already answered this request. Reload the list.", detail: [] };
    case "project_exists":
      return { message: "There's already a project with that name. Change the name and approve again.", detail: [] };
    case "write_prerequisites_missing":
      return { message: "OSM edit capability is not configured on this backend.", detail: e.detail };
    default:
      return { message: `Request failed: ${e.message} (HTTP ${e.status})`, detail: [] };
  }
}

export interface Project {
  id: number;
  name: string;
  displayName: string | null;
  enabled: boolean;
  /** Choice challenges in the project. */
  campaigns: number;
  /** Of those, enabled and published. */
  published: number;
}

export interface Campaign {
  id: number;
  name: string;
  enabled: boolean;
  /** Tagged mobile-survey-v1 by Publish. */
  published: boolean;
  /** Shown in the app: enabled, published and the project on. */
  listed: boolean;
  modified: string;
  project: { id: number; name: string; displayName: string | null; enabled: boolean };
  tasks: { total: number; checked: number; needsLook: number };
}

export const listProjects = () =>
  api<{ projects: Project[] }>("/api/v2/mobile-admin/projects").then((r) => r.projects);
export const createProject = (name: string, displayName?: string) =>
  api<Project>("/api/v2/mobile-admin/projects", {
    method: "POST",
    body: JSON.stringify(displayName ? { name, displayName } : { name }),
  });
export const setProjectEnabled = (id: number, enabled: boolean) =>
  api<Project>(`/api/v2/mobile-admin/projects/${id}/enabled`, { method: "PUT", body: JSON.stringify({ enabled }) });
export const listCampaigns = () =>
  api<{ campaigns: Campaign[] }>("/api/v2/mobile-admin/campaigns").then((r) => r.campaigns);

/** A challenge as the stock read returns it; only the fields the campaign page shows. */
export interface ChallengeDetail extends ChallengeDraft {
  id: number;
  enabled: boolean;
  parent: number;
}

export const getChallenge = (id: number) => api<ChallengeDetail>(`/api/v2/challenge/${id}`);

export type ResultsFormat = "csv" | "geojson";

/** A challenge's campaign results as a file: tasks, statuses, answers, changesets. */
export async function fetchChallengeResults(challengeId: number, format: ResultsFormat): Promise<{ blob: Blob; filename: string }> {
  const res = await authorized(`/api/v2/mobile-admin/challenges/${challengeId}/results?format=${format}`, {
    headers: { Accept: format === "csv" ? "text/csv" : "application/geo+json" },
  });
  if (!res.ok) throw errorFrom(res, await res.json().catch(() => undefined));
  return { blob: await res.blob(), filename: `challenge-${challengeId}-results.${format}` };
}

/** One run of the confirm queue (H1b; backend docs/mobile-admin-api.md, "Confirm queue"). */
export interface QueueReport {
  /** The tag-fix challenge the queue lives in; 0 while the campaign has none. */
  queueChallengeId: number;
  queued: number;
  alreadyQueued: number;
  done: number;
  stale: number;
  gone: number;
  disagree: number;
}

/** Checks the campaign's agreed answers against OSM and queues the ones that still apply. */
export const generateQueue = (challengeId: number) =>
  api<QueueReport>(`/api/v2/mobile-admin/challenges/${challengeId}/queue`, { method: "POST" });

/** The queue as line-by-line GeoJSON for maproulette.org, or undefined before the first run. */
export async function fetchQueueExport(challengeId: number): Promise<{ blob: Blob; filename: string } | undefined> {
  const res = await authorized(`/api/v2/mobile-admin/challenges/${challengeId}/queue/export`, {
    headers: { Accept: "application/geo+json-seq" },
  });
  if (!res.ok) {
    const error = errorFrom(res, await res.json().catch(() => undefined));
    if (error.code === "no_queue") return undefined;
    throw error;
  }
  return { blob: await res.blob(), filename: `confirm-queue-${challengeId}.geojson` };
}

/** A stop someone reported as not there or moved (the built-in outcomes). */
export interface StopReport {
  taskId: number;
  /** The stop's name tag, else "Stop <ref>", else "Unnamed stop" (as the app labels it). */
  label: string;
  element: string;
  outcome: "not-here" | "moved";
  outcomeLabel: string;
  reportedAt?: string;
  count: number;
  /** The stop's map position, [longitude, latitude]. */
  at?: [number, number];
  /** For a moved stop, the spot the mapper reported. */
  moved?: { at: [number, number]; source: string; distanceM?: number };
}

const reportOutcomes = new Set(["not-here", "moved"]);

type ResultFeature = {
  geometry: { coordinates: [number, number] } | null;
  properties: Record<string, unknown>;
};

/** The challenge's not-here and moved reports, read from its GeoJSON results export. */
export async function listReports(challengeId: number): Promise<StopReport[]> {
  const { blob } = await fetchChallengeResults(challengeId, "geojson");
  const features = (JSON.parse(await blob.text()) as { features: ResultFeature[] }).features;
  const moved = new Map<number, ResultFeature>();
  for (const f of features) if (f.properties.kind === "reported_position") moved.set(f.properties.taskId as number, f);
  return features
    .filter((f) => f.properties.kind === undefined && reportOutcomes.has(f.properties.outcome as string))
    .map((f) => {
      const p = f.properties;
      const spot = moved.get(p.taskId as number);
      return {
        taskId: p.taskId as number,
        label: stopLabel(p.featureName as string | null, p.featureRef as string | null),
        element: p.element as string,
        outcome: p.outcome as StopReport["outcome"],
        outcomeLabel: (p.outcomeLabel as string) ?? (p.outcome as string),
        reportedAt: (p.completedAt as string | null) ?? undefined,
        count: (p.reportCount as number) || 1,
        at: f.geometry?.coordinates,
        moved: spot?.geometry
          ? { at: spot.geometry.coordinates, source: spot.properties.source as string, distanceM: (spot.properties.distanceM as number | null) ?? undefined }
          : undefined,
      };
    })
    .sort((a, b) => (b.reportedAt ?? "").localeCompare(a.reportedAt ?? ""));
}

export function stopLabel(name?: string | null, ref?: string | null): string {
  if (name) return name;
  return ref ? `Stop ${ref}` : "Unnamed stop";
}

/** iD on openstreetmap.org with the element selected, centered on `at` when given. */
export function idEditorUrl(element: string, at?: [number, number]): string {
  const [type, id] = element.split("/");
  const map = at ? `#map=20/${at[1].toFixed(6)}/${at[0].toFixed(6)}` : "";
  return `https://www.openstreetmap.org/edit?editor=id&${type}=${id}${map}`;
}

/** A campaign's live progress page (BACKLOG #12; backend docs/mobile-admin-api.md, "Live progress page"). */
export interface LivePage {
  challengeId: number;
  /** The link's secret; the page is at liveLink(token). */
  token: string;
  enabled: boolean;
  showAnswers: boolean;
  /** Counts people who saved a stop since then; null for no count. */
  eventStart: string | null;
  /** When live mode ended; null while live. */
  endedAt: string | null;
  updatedAt: string;
}

export type LivePageChange = Partial<Pick<LivePage, "enabled" | "showAnswers" | "eventStart">> & { ended?: boolean };

/** The campaign's live page, or undefined when it has none yet (`404 no_live_page`). */
export const getLivePage = (challengeId: number) =>
  api<LivePage>(`/api/v2/mobile-admin/challenges/${challengeId}/live`).catch((e: unknown) => {
    if (e instanceof ApiError && e.code === "no_live_page") return undefined;
    throw e;
  });
/** Changes the given settings; the first call creates the page (on, answers hidden, live). */
export const updateLivePage = (challengeId: number, change: LivePageChange) =>
  api<LivePage>(`/api/v2/mobile-admin/challenges/${challengeId}/live`, { method: "PUT", body: JSON.stringify(change) });
/** A new token: the old link stops working. */
export const rotateLivePage = (challengeId: number) =>
  api<LivePage>(`/api/v2/mobile-admin/challenges/${challengeId}/live/rotate`, { method: "POST" });

/** ORG-ONB: someone's ask to run campaigns (backend docs/mobile-admin-api.md "Organizer requests"). */
export interface OrganizerRequest {
  id: number;
  state: "open" | "approved" | "declined";
  place: string;
  subject: string;
  group: string | null;
  createdAt: string;
  decidedAt: string | null;
  /** The super-user's note on a decline, shown to the requester. */
  note: string | null;
  /** The project an approval made. */
  projectId: number | null;
}

/** The signed-in user's own request, and whether they may ask now. Only a request grant reads it. */
export interface MyOrganizerRequest {
  /** Their OpenStreetMap username. */
  name: string;
  osmId: number;
  organizer: boolean;
  canRequest: boolean;
  /** After a decline: the form comes back then (30 days on). */
  askAgainAt: string | null;
  request: OrganizerRequest | null;
}

export const myOrganizerRequest = () => api<MyOrganizerRequest>("/api/v2/mobile-admin/organizer-request");

export const askToOrganize = (ask: { place: string; subject: string; group?: string }) =>
  api<OrganizerRequest>("/api/v2/mobile-admin/organizer-request", {
    method: "POST",
    body: JSON.stringify({ ...ask, policyAccepted: true }),
  });

/** An open request as super-users see it, with the OSM account snapshot taken when it was made. */
export interface OpenOrganizerRequest {
  id: number;
  userId: number;
  osmId: number;
  /** Their OpenStreetMap username. */
  name: string;
  osmAccount: { createdAt: string | null; changesets: number | null } | null;
  place: string;
  subject: string;
  group: string | null;
  policyAcceptedAt: string;
  createdAt: string;
}

export const listOrganizerRequests = () =>
  api<{ requests: OpenOrganizerRequest[] }>("/api/v2/mobile-admin/organizer-requests").then((r) => r.requests);

/** Makes the project, gives them Write on it and lists them as an organizer, in one step. */
export const approveOrganizerRequest = (id: number, projectName: string) =>
  api<OrganizerRequest>(`/api/v2/mobile-admin/organizer-requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ projectName }),
  });

export const declineOrganizerRequest = (id: number, note: string) =>
  api<OrganizerRequest>(`/api/v2/mobile-admin/organizer-requests/${id}/decline`, {
    method: "POST",
    body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
  });

/** A campaign organizer and the projects they run (D8, backend docs/mobile-admin-api.md "Organizers"). */
export interface Organizer {
  userId: number;
  osmId: number;
  name: string;
  grantedBy: number;
  createdAt: string;
  projects: { id: number; name: string; displayName: string | null; role: OrganizerRole }[];
}

export type OrganizerRole = "write" | "admin";

export const listOrganizers = () =>
  api<{ organizers: Organizer[] }>("/api/v2/mobile-admin/organizers").then((r) => r.organizers);

/** Gives the person the role on the project and puts them on the organizer list. */
export const addOrganizer = (osmUsername: string, projectId: number, role: OrganizerRole) =>
  api<Organizer>("/api/v2/mobile-admin/organizers", {
    method: "POST",
    body: JSON.stringify({ osmUsername, projectId, role }),
  });

/** Off the organizer list; their project roles stay. */
export const removeOrganizer = (userId: number) =>
  api<void>(`/api/v2/mobile-admin/organizers/${userId}`, { method: "DELETE" });

export const removeOrganizerProject = (userId: number, projectId: number) =>
  api<Organizer>(`/api/v2/mobile-admin/organizers/${userId}/projects/${projectId}`, { method: "DELETE" });
