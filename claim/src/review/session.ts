import { challengeFor, randomString } from "../../../src/pkce";
import { config } from "../config";

/**
 * The review page's sign-in: its own public client with `tasks:read tasks:write` only, so the grant
 * can't write to OpenStreetMap (handback-copy §2: nothing uploads from this page). Same flow as the
 * claim page (session.ts): PKCE, the refresh token in sessionStorage, the access token in memory.
 */
const SCOPE = "tasks:read tasks:write";
const PENDING = "review.pending";
const REFRESH = "review.refresh";
const TOKEN = "review.token";
const NAME = "review.name";

export class SignInError extends Error {}

let access: { token: string; expiresAt: number } | undefined;

const redirectUri = () => `${location.origin}/review/callback`;

/** The page token, kept for the way back from OpenStreetMap. */
export function rememberToken(t: string) {
  sessionStorage.setItem(TOKEN, t);
}
export function rememberedToken(): string | undefined {
  return sessionStorage.getItem(TOKEN) ?? undefined;
}

export function signedIn(): boolean {
  return access !== undefined || sessionStorage.getItem(REFRESH) !== null;
}

export function displayName(): string | undefined {
  return sessionStorage.getItem(NAME) ?? undefined;
}

export async function startSignIn(): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(32);
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
  const q = new URLSearchParams({
    response_type: "code",
    client_id: config().reviewClientId,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    code_challenge: await challengeFor(verifier),
    code_challenge_method: "S256",
  });
  location.assign(`${config().backend}/oauth/mobile/authorize?${q}`);
}

/** Handles /review/callback. Throws SignInError when the sign-in didn't finish. */
export async function completeSignIn(params: URLSearchParams): Promise<void> {
  const pending = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  const { verifier, state } = pending ? (JSON.parse(pending) as { verifier: string; state: string }) : { verifier: "", state: "" };
  const code = params.get("code");
  if (!state || params.get("state") !== state || params.get("error") || !code || !verifier) throw new SignInError();
  const t = await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() });
  const me = await fetch(`${config().backend}/oauth/mobile/me`, { headers: { Authorization: `Bearer ${t}` } }).catch(() => undefined);
  if (me?.ok) sessionStorage.setItem(NAME, ((await me.json()) as { displayName: string }).displayName);
}

async function token(fields: Record<string, string>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${config().backend}/oauth/mobile/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config().reviewClientId, ...fields }),
    });
  } catch {
    throw new SignInError();
  }
  if (!res.ok) {
    forget();
    throw new SignInError();
  }
  const t = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  access = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  sessionStorage.setItem(REFRESH, t.refresh_token);
  return t.access_token;
}

let refreshing: Promise<string> | undefined;

/** A valid access token, refreshed when needed (single flight: refresh tokens rotate). */
export async function accessToken(): Promise<string> {
  if (access && access.expiresAt - Date.now() > 30_000) return access.token;
  const refresh = sessionStorage.getItem(REFRESH);
  if (!refresh) throw new SignInError();
  refreshing ??= token({ grant_type: "refresh_token", refresh_token: refresh }).finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}

function forget() {
  access = undefined;
  sessionStorage.removeItem(REFRESH);
  sessionStorage.removeItem(NAME);
}

export async function signOut(): Promise<void> {
  const t = sessionStorage.getItem(REFRESH) ?? access?.token;
  forget();
  if (!t) return;
  await fetch(`${config().backend}/oauth/mobile/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config().reviewClientId, token: t }),
  }).catch(() => undefined);
}
