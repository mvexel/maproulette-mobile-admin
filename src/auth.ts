import { config } from "./config";
import { challengeFor, randomString } from "./pkce";

const SCOPE = "mobile:admin";
const PENDING_KEY = "mrma.pending";
const REFRESH_KEY = "mrma.refresh";

/** A sign-in or session problem, with a user-facing message. */
export class AuthError extends Error {}

/** The backend refused the sign-in because the account is not a MapRoulette super-user. */
export class NotSuperUserError extends AuthError {}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// The access token lives in memory only; the refresh token in sessionStorage, so it survives a
// reload but not closing the tab, and is never shared with other tabs.
let access: { token: string; expiresAt: number } | undefined;
let refreshing: Promise<string> | undefined;
const listeners = new Set<() => void>();

function notify() {
  for (const l of listeners) l();
}

export function onAuthChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function hasSession(): boolean {
  return access !== undefined || sessionStorage.getItem(REFRESH_KEY) !== null;
}

const redirectUri = () => `${location.origin}/callback`;

export async function startSignIn(): Promise<void> {
  const verifier = randomString(48); // 64 characters; RFC 7636 allows 43 to 128
  const state = randomString(32);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: config().clientId,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
  });
  location.assign(`${config().backend}/oauth/mobile/authorize?${q}`);
}

/** Handles the /callback redirect. Throws AuthError with a user-facing message. */
export async function completeSignIn(params: URLSearchParams): Promise<void> {
  const pending = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  const { verifier, state } = pending
    ? (JSON.parse(pending) as { verifier: string; state: string })
    : { verifier: undefined, state: undefined };
  if (!state) throw new AuthError("Sign-in was not started in this tab. Please try again.");
  if (params.get("state") !== state) throw new AuthError("Sign-in state mismatch. Please try again.");
  const err = params.get("error");
  if (err === "access_denied" && /super-user/i.test(params.get("error_description") ?? "")) {
    throw new NotSuperUserError("This account is not a MapRoulette super-user.");
  }
  if (err === "access_denied") throw new AuthError("Sign-in was cancelled.");
  if (err) throw new AuthError(`Sign-in failed: ${params.get("error_description") ?? err}`);
  const code = params.get("code");
  if (!code || !verifier) throw new AuthError("Sign-in returned no code. Please try again.");
  store(await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() }));
}

const TOKEN_ERRORS: Record<string, string> = {
  invalid_grant: "The sign-in expired or was revoked. Please sign in again.",
  invalid_client: "The backend does not know this admin client, or it is disabled.",
};

async function tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${config().backend}/oauth/mobile/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: config().clientId, ...fields }),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AuthError(TOKEN_ERRORS[error ?? ""] ?? `Token request failed (${error ?? `HTTP ${res.status}`}).`);
  }
  return (await res.json()) as TokenResponse;
}

function store(t: TokenResponse) {
  access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  sessionStorage.setItem(REFRESH_KEY, t.refresh_token);
  notify();
}

export function clearSession() {
  access = undefined;
  sessionStorage.removeItem(REFRESH_KEY);
  notify();
}

/** Forgets the session locally, then revokes its grant family on the backend (best effort). */
export async function signOut(): Promise<void> {
  const token = sessionStorage.getItem(REFRESH_KEY) ?? access?.token;
  clearSession();
  if (!token) return;
  await fetch(`${config().backend}/oauth/mobile/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config().clientId, token }),
  }).catch(() => undefined);
}

/**
 * Returns a valid access token, refreshing when needed. Refreshes are single-flight: refresh
 * tokens rotate, and presenting an old one revokes the whole grant family.
 */
export async function accessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && access && access.expiresAt - Date.now() > 30_000) return access.token;
  refreshing ??= doRefresh().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

async function doRefresh(): Promise<string> {
  const refresh = sessionStorage.getItem(REFRESH_KEY);
  if (!refresh) throw new AuthError("Not signed in.");
  try {
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
    store(t);
    return t.access_token;
  } catch (e) {
    // Never retry an old refresh token: the backend may already have rotated it.
    clearSession();
    throw e;
  }
}
