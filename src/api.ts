import { AuthError, accessToken, clearSession } from "./auth";
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

/** The choice payloads of a challenge's first tasks (a sample is enough for the publish check). */
export async function listTaskWork(challengeId: number, limit = 200): Promise<unknown[]> {
  const tasks = await api<{ cooperativeWork?: unknown }[]>(`/api/v2/challenge/${challengeId}/tasks?limit=${limit}`);
  return tasks.map((t) => (typeof t.cooperativeWork === "string" ? JSON.parse(t.cooperativeWork) : t.cooperativeWork));
}

export type ResultsFormat = "csv" | "geojson";

/** A challenge's campaign results as a file: tasks, statuses, answers, changesets. */
export async function fetchChallengeResults(challengeId: number, format: ResultsFormat): Promise<{ blob: Blob; filename: string }> {
  const res = await authorized(`/api/v2/mobile-admin/challenges/${challengeId}/results?format=${format}`, {
    headers: { Accept: format === "csv" ? "text/csv" : "application/geo+json" },
  });
  if (!res.ok) throw errorFrom(res, await res.json().catch(() => undefined));
  return { blob: await res.blob(), filename: `challenge-${challengeId}-results.${format}` };
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
