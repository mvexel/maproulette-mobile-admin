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
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; detail?: string[] };
    throw new ApiError(res.status, b.error ?? `http_${res.status}`, b.detail);
  }
  return body as T;
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

export const getWritePolicy = () => api<WritePolicy>("/api/v2/mobile-admin/write-policy");
export const setWritePolicy = (enabled: boolean) =>
  api<WritePolicy>("/api/v2/mobile-admin/write-policy", {
    method: "PUT",
    body: JSON.stringify({ enabled }),
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
