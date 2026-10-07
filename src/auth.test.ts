import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockBackend } from "../mock/server.ts";
import { listClients, me } from "./api";
import { AuthError, accessToken, completeSignIn, hasSession, NotSuperUserError, signOut } from "./auth";
import { config } from "./config";
import { challengeFor } from "./pkce";
import { APP_ORIGIN, assign, browserSignIn, reset, setUp, signIn } from "./testing";

let mock: MockBackend;
beforeAll(async () => {
  mock = await setUp();
});
afterAll(() => mock.close());
beforeEach(() => reset(mock));

const refreshToken = () => sessionStorage.getItem("mrma.refresh");

describe("sign-in", () => {
  it("sends a PKCE S256 authorization request for mobile:admin", async () => {
    await browserSignIn(mock, "super");
    const url = new URL(assign.mock.calls[0][0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${mock.url}/oauth/mobile/authorize`);
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("maproulette-mobile-admin");
    expect(q.get("redirect_uri")).toBe(`${APP_ORIGIN}/callback`);
    expect(q.get("scope")).toBe("mobile:admin");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("code_challenge_method")).toBe("S256");
    const pending = JSON.parse(sessionStorage.getItem("mrma.pending") ?? "{}") as { verifier: string; state: string };
    expect(q.get("state")).toBe(pending.state);
    expect(q.get("code_challenge")).toBe(await challengeFor(pending.verifier));
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it("exchanges the code and keeps only the refresh token in sessionStorage", async () => {
    await signIn(mock);
    expect(hasSession()).toBe(true);
    expect(sessionStorage.getItem("mrma.pending")).toBeNull();
    expect(refreshToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await me()).displayName).toBe("mock-superuser");
    expect(mock.stats.authorizationCodes).toBe(1);
  });

  it("fails the exchange when the PKCE verifier does not match", async () => {
    const params = await browserSignIn(mock, "super");
    const pending = JSON.parse(sessionStorage.getItem("mrma.pending") ?? "{}") as { state: string };
    sessionStorage.setItem("mrma.pending", JSON.stringify({ ...pending, verifier: "x".repeat(64) }));
    await expect(completeSignIn(params)).rejects.toThrow(/expired or was revoked/);
    expect(hasSession()).toBe(false);
  });

  it("rejects a callback whose state does not match", async () => {
    const params = await browserSignIn(mock, "super");
    params.set("state", "forged");
    await expect(completeSignIn(params)).rejects.toThrow(/state mismatch/);
    expect(hasSession()).toBe(false);
  });

  it("rejects a callback that was not started in this tab", async () => {
    const params = await browserSignIn(mock, "super");
    sessionStorage.clear();
    await expect(completeSignIn(params)).rejects.toThrow(/not started in this tab/);
  });

  it("reports a non-super-user as NotSuperUserError, without a session", async () => {
    const params = await browserSignIn(mock, "plain");
    expect(params.get("error")).toBe("access_denied");
    await expect(completeSignIn(params)).rejects.toBeInstanceOf(NotSuperUserError);
    expect(hasSession()).toBe(false);
    expect(mock.stats.authorizationCodes).toBe(0);
  });

  it("treats a plain access_denied (consent declined) as cancelled", async () => {
    const params = await browserSignIn(mock, "super");
    const denied = new URLSearchParams({ error: "access_denied", state: params.get("state") ?? "" });
    const err = await completeSignIn(denied).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).not.toBeInstanceOf(NotSuperUserError);
    expect((err as Error).message).toMatch(/cancelled/);
  });
});

describe("refresh", () => {
  it("is single-flight: concurrent callers share one rotation", async () => {
    await signIn(mock);
    const before = refreshToken();
    const tokens = await Promise.all([accessToken(true), accessToken(true), accessToken(true)]);
    expect(new Set(tokens).size).toBe(1);
    expect(mock.stats.refreshes).toBe(1);
    expect(mock.stats.replays).toBe(0);
    expect(refreshToken()).not.toBe(before);
    // The rotated token keeps working, so the family was not revoked.
    await accessToken(true);
    expect(mock.stats.refreshes).toBe(2);
    expect(mock.stats.replays).toBe(0);
  });

  it("refreshes on a page reload (access token only in memory)", async () => {
    await signIn(mock);
    const saved = refreshToken();
    // A reload loses the module state; simulate with a fresh module instance.
    vi.resetModules();
    const fresh = await import("./auth");
    const { configure } = await import("./config");
    configure(config());
    expect(fresh.hasSession()).toBe(true);
    await fresh.accessToken();
    expect(mock.stats.refreshes).toBe(1);
    expect(refreshToken()).not.toBe(saved);
  });

  it("clears the session when the refresh token is rejected", async () => {
    await signIn(mock);
    await fetch(`${mock.url}/oauth/mobile/revoke`, {
      method: "POST",
      body: new URLSearchParams({ client_id: "maproulette-mobile-admin", token: refreshToken() ?? "" }),
    });
    await expect(accessToken(true)).rejects.toBeInstanceOf(AuthError);
    expect(hasSession()).toBe(false);
  });
});

describe("api 401 handling", () => {
  it("refreshes once and retries after a 401", async () => {
    await signIn(mock);
    mock.expireAccess();
    const clients = await listClients();
    expect(clients.map((c) => c.id)).toContain("maproulette-mobile-admin");
    expect(mock.stats.refreshes).toBe(1);
  });

  it("ends the session when the refresh fails too", async () => {
    await signIn(mock);
    await fetch(`${mock.url}/oauth/mobile/revoke`, {
      method: "POST",
      body: new URLSearchParams({ client_id: "maproulette-mobile-admin", token: refreshToken() ?? "" }),
    });
    await expect(listClients()).rejects.toBeInstanceOf(AuthError);
    expect(hasSession()).toBe(false);
  });
});

describe("sign-out", () => {
  it("clears the session and revokes the grant family", async () => {
    await signIn(mock);
    const old = refreshToken() ?? "";
    await signOut();
    expect(hasSession()).toBe(false);
    expect(refreshToken()).toBeNull();
    expect(mock.stats.revokes).toBe(1);
    const res = await fetch(`${mock.url}/oauth/mobile/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: "maproulette-mobile-admin", refresh_token: old }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant" });
  });

  it("is a no-op without a session", async () => {
    await signOut();
    expect(mock.stats.revokes).toBe(0);
  });
});
