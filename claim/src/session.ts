import { challengeFor, randomString } from "../../src/pkce";
import { config } from "./config";

/**
 * The claim page's own sign-in: authorization code + PKCE against the backend, which sends the
 * person through OpenStreetMap (deferred-signup-api.md §3.7). Everything lives in sessionStorage,
 * so it survives the OSM round trip and a reload, but not closing the tab. The access token is
 * kept in memory only.
 */
const SCOPE = "tasks:read tasks:write osm:tagfix";
const PENDING = "claim.pending";
const TOKEN = "claim.token";
const REFRESH = "claim.refresh";
const CLAIM = "claim.claim";

export class SignInError extends Error {}

let access: { token: string; expiresAt: number } | undefined;

const redirectUri = () => `${location.origin}/claim/callback`;

/** Remembers the claim token for after the sign-in redirect. */
export function rememberToken(t: string) {
  sessionStorage.setItem(TOKEN, t);
}
export function rememberedToken(): string | undefined {
  return sessionStorage.getItem(TOKEN) ?? undefined;
}

/** The claim this tab started, so a reload keeps showing its progress. */
export function rememberClaim(c: { claimId: number; displayName: string }) {
  sessionStorage.setItem(CLAIM, JSON.stringify(c));
}
export function rememberedClaim(): { claimId: number; displayName: string } | undefined {
  const v = sessionStorage.getItem(CLAIM);
  return v ? (JSON.parse(v) as { claimId: number; displayName: string }) : undefined;
}

export function signedIn(): boolean {
  return access !== undefined || sessionStorage.getItem(REFRESH) !== null;
}

export async function startSignIn(): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(32);
  sessionStorage.setItem(PENDING, JSON.stringify({ verifier, state }));
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

/** Handles /claim/callback. Throws SignInError when the sign-in didn't finish. */
export async function completeSignIn(params: URLSearchParams): Promise<void> {
  const pending = sessionStorage.getItem(PENDING);
  sessionStorage.removeItem(PENDING);
  const { verifier, state } = pending ? (JSON.parse(pending) as { verifier: string; state: string }) : { verifier: "", state: "" };
  const code = params.get("code");
  if (!state || params.get("state") !== state || params.get("error") || !code || !verifier) throw new SignInError();
  await token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri() });
}

async function token(fields: Record<string, string>): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${config().backend}/oauth/mobile/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config().clientId, ...fields }),
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
}

/**
 * Revokes this page's grant (§3.7: once the claim is done, or to switch account) and forgets it.
 * The phone's grant family keeps its own copy of the OSM token.
 */
export async function signOut(): Promise<void> {
  const t = sessionStorage.getItem(REFRESH) ?? access?.token;
  forget();
  sessionStorage.removeItem(CLAIM);
  if (!t) return;
  await fetch(`${config().backend}/oauth/mobile/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config().clientId, token: t }),
  }).catch(() => undefined);
}
