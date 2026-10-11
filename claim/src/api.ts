import { config } from "./config";

/** A failed call, with the backend's error code (or "network"). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

/** The campaign the guest's answers belong to (deferred-signup-api.md §3.11). */
export interface Campaign {
  challengeId: number;
  name: string;
  /** What the campaign's places are called; the backend defaults to place/places. */
  noun: { one: string; other: string };
  hashtag: string | null;
  wikiUrl: string | null;
  organizerName: string | null;
  /** ISO date. */
  eventDate: string | null;
}

/** The claim behind a claimed token (§3.11): lets the page tell "on the map" from "sign in again". */
export interface PreviewClaim {
  state: ClaimState;
  claimedAs: { displayName: string };
  counts: { total: number; published: number; pending: number; skipped: number; superseded: number; failed: number };
}

/** POST /api/v2/mobile-claim/preview (deferred-signup-api.md §3.6, with the §3.10 and §3.11 additions). */
export interface Preview {
  state: "active" | "claimed" | "expired" | "deleted";
  expiresAt: string;
  pending: number;
  challenges: { id: number; name: string; pending: number }[];
  tasks: {
    taskId: number;
    lat: number;
    lon: number;
    answeredAt: string;
    label?: string;
    answers?: { prompt: string; label: string }[];
  }[];
  summary: { questionId: string; label: string; counts: Record<string, number> }[];
  writesEnabled: boolean;
  campaign: Campaign;
  /** Campaign-wide: tasks checked of all tasks. */
  tally: { checked: number; total: number };
  /** Questions with at least one "no" answer. */
  found: { questionId: string; prompt: string; noCount: number }[];
  claim: PreviewClaim | null;
}

export interface ClaimUser {
  displayName: string;
  osmId: number;
}

/** POST /api/v2/mobile-claim (§3.7). `waiting` is the §3.10 write-switch state. */
export interface ClaimStarted {
  claimId: number;
  state: ClaimState;
  pending: number;
  user: ClaimUser;
}

export type ClaimState = "queued" | "running" | "waiting" | "reauth_required" | "done" | "partial" | "failed";
export type ItemState = "published" | "superseded" | "skipped_stale" | "failed";

/** GET /api/v2/mobile-claim/:id (§3.7). */
export interface ClaimStatus {
  claimId: number;
  state: ClaimState;
  total: number;
  published: number;
  skipped: number;
  superseded: number;
  failed: number;
  items: { taskId: number; state: ItemState; changesetId?: number; dropped: string[] }[];
}

async function call<T>(method: string, path: string, body?: unknown, bearer?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config().backend}${path}`, {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network");
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, typeof json.error === "string" ? json.error : `http_${res.status}`, json);
  return json as T;
}

export const preview = (claimToken: string) => call<Preview>("POST", "/api/v2/mobile-claim/preview", { claimToken });
export const deleteData = (claimToken: string) => call<void>("POST", "/api/v2/mobile-claim/delete", { claimToken });
export const stopReminders = (claimToken: string) =>
  call<void>("POST", "/api/v2/mobile-claim/stop-reminders", { claimToken });

/** Starts the claim, or returns the existing one for the same user (200). */
export const startClaim = (claimToken: string, accessToken: string) =>
  call<ClaimStarted>("POST", "/api/v2/mobile-claim", { claimToken }, accessToken);

export const claimStatus = (claimId: number, accessToken: string) =>
  call<ClaimStatus>("GET", `/api/v2/mobile-claim/${claimId}`, undefined, accessToken);

/** Puts failed rows back in the queue (§3.11); also the step after signing in again. */
export const retryClaim = (claimId: number, accessToken: string) =>
  call<ClaimStatus & { retried: number }>("POST", `/api/v2/mobile-claim/${claimId}/retry`, {}, accessToken);

export const me = (accessToken: string) =>
  call<{ id: number; osmId: number; displayName: string; scope: string }>("GET", "/oauth/mobile/me", undefined, accessToken);
