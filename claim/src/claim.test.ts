import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_CLAIM_TOKENS, type MockBackend, startMockBackend } from "../../mock/server.ts";
import { ApiError, claimStatus, deleteData, me, preview, startClaim, stopReminders } from "./api";
import { configure } from "./config";
import { route, tokenFrom } from "./link";
import { accessToken, completeSignIn, rememberClaim, rememberedClaim, SignInError, signedIn, signOut, startSignIn } from "./session";
import { count, found } from "./words";

const CLAIM_ORIGIN = "https://claim.test";
const T = MOCK_CLAIM_TOKENS;

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  clear() {
    this.items.clear();
  }
}
const assign = vi.fn<(url: string) => void>();

let mock: MockBackend;
beforeAll(async () => {
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("location", { origin: CLAIM_ORIGIN, assign });
  mock = await startMockBackend({ adminOrigin: "https://admin.test", claimOrigin: CLAIM_ORIGIN });
  configure({ backend: mock.url, clientId: "maproulette-claim" });
});
afterAll(() => mock.close());
beforeEach(async () => {
  await signOut();
  sessionStorage.clear();
  assign.mockClear();
  mock.reset();
});

/** Plays the browser through the mock's authorize page, as mock-mapper (or cancels). */
async function signIn(as: "plain" | "cancel" = "plain"): Promise<URLSearchParams> {
  await startSignIn();
  const authorize = assign.mock.calls.at(-1)?.[0] ?? "";
  const html = await (await fetch(authorize)).text();
  const decide = [...html.matchAll(/href="([^"]+&as=(\w+))"/g)].find((m) => m[2] === as)?.[1] ?? "";
  const back = await fetch(new URL(decide.replaceAll("&amp;", "&"), mock.url), { redirect: "manual" });
  const target = new URL(back.headers.get("location") ?? "");
  expect(`${target.origin}${target.pathname}`).toBe(`${CLAIM_ORIGIN}/claim/callback`);
  return target.searchParams;
}

describe("links", () => {
  it("routes the emailed paths", () => {
    expect(route("/claim")).toBe("claim");
    expect(route("/claim/")).toBe("claim");
    expect(route("/claim/callback")).toBe("callback");
    expect(route("/claim/delete")).toBe("delete");
    expect(route("/claim/stop-reminders")).toBe("stop-reminders");
    expect(route("/claim/other")).toBe("unknown");
  });

  it("takes only a well-formed token from the fragment", () => {
    expect(tokenFrom(`#t=${T.partial}`)).toBe(T.partial);
    expect(tokenFrom("#t=short")).toBeUndefined();
    expect(tokenFrom(`#t=${T.partial}!`)).toBeUndefined();
    expect(tokenFrom("")).toBeUndefined();
  });
});

describe("words", () => {
  it("counts with the campaign noun or places", () => {
    expect(count(1)).toBe("1 place");
    expect(count(4)).toBe("4 places");
    expect(count(1, { noun: { one: "stop", many: "stops" } })).toBe("1 stop");
  });

  it("summarises the no answers, most first", async () => {
    const p = await preview(T.partial);
    expect(found(p)).toMatch(/^\d+ had no \w+/);
    expect(found({ ...p, summary: [] })).toBeUndefined();
  });
});

describe("claim API against the mock", () => {
  it("previews each token state, and 404 for an unknown token", async () => {
    const p = await preview(T.partial);
    expect(p.state).toBe("active");
    expect(p.pending).toBe(4);
    expect(p.writesEnabled).toBe(true);
    expect(p.tasks[0]).toMatchObject({ taskId: 101, label: expect.any(String) });
    expect((await preview(T.claimed)).state).toBe("claimed");
    expect((await preview(T.expired)).state).toBe("expired");
    expect((await preview(T.deleted)).state).toBe("deleted");
    await expect(preview("z".repeat(43))).rejects.toMatchObject({ status: 404 });
  });

  it("signs in with the claim scopes and PKCE", async () => {
    const params = await signIn();
    const q = new URL(assign.mock.calls[0][0]).searchParams;
    expect(q.get("client_id")).toBe("maproulette-claim");
    expect(q.get("scope")).toBe("tasks:read tasks:write osm:tagfix");
    expect(q.get("redirect_uri")).toBe(`${CLAIM_ORIGIN}/claim/callback`);
    expect(q.get("code_challenge_method")).toBe("S256");
    await completeSignIn(params);
    expect(signedIn()).toBe(true);
    expect((await me(await accessToken())).displayName).toBe("mock-mapper");
  });

  it("treats a cancelled sign-in as not finished", async () => {
    await expect(completeSignIn(await signIn("cancel"))).rejects.toBeInstanceOf(SignInError);
    expect(signedIn()).toBe(false);
  });

  it("claims, reports each item, and returns the same claim to the same user", async () => {
    await completeSignIn(await signIn());
    const started = await startClaim(T.partial, await accessToken());
    expect(started).toMatchObject({ state: "queued", pending: 4, user: { displayName: "mock-mapper" } });
    let s = await claimStatus(started.claimId, await accessToken());
    while (s.state !== "done" && s.state !== "failed") s = await claimStatus(started.claimId, await accessToken());
    expect(s.state).toBe("done");
    expect(s.items.map((i) => i.state)).toEqual(["published", "published", "skipped_stale", "superseded"]);
    expect(s.items[1].dropped).toEqual(["bench"]);
    expect((await startClaim(T.partial, await accessToken())).claimId).toBe(started.claimId);
    expect((await preview(T.partial)).state).toBe("claimed");
  });

  it("waits while writes are off, then runs", async () => {
    await fetch(`${mock.url}/__mock/claim-writes?enabled=false`, { method: "POST" });
    expect((await preview(T.all)).writesEnabled).toBe(false);
    await completeSignIn(await signIn());
    const started = await startClaim(T.all, await accessToken());
    expect(started.state).toBe("waiting");
    expect((await claimStatus(started.claimId, await accessToken())).state).toBe("waiting");
    await fetch(`${mock.url}/__mock/claim-writes?enabled=true`, { method: "POST" });
    expect((await claimStatus(started.claimId, await accessToken())).state).not.toBe("waiting");
  });

  it("needs a signed-in user to claim", async () => {
    await expect(startClaim(T.partial, "not-a-token")).rejects.toMatchObject({ status: 401 });
  });

  it("deletes the data and stops reminders without signing in", async () => {
    await stopReminders(T.all);
    expect((await preview(T.all)).state).toBe("active");
    await deleteData(T.partial);
    expect((await preview(T.partial)).state).toBe("deleted");
  });

  it("revokes the page's grant and forgets the claim on sign-out", async () => {
    await completeSignIn(await signIn());
    rememberClaim({ claimId: 1, displayName: "mock-mapper" });
    const revokes = mock.stats.revokes;
    await signOut();
    expect(mock.stats.revokes).toBe(revokes + 1);
    expect(signedIn()).toBe(false);
    expect(rememberedClaim()).toBeUndefined();
    await expect(accessToken()).rejects.toBeInstanceOf(SignInError);
  });

  it("reports network failures as ApiError", async () => {
    configure({ backend: "http://127.0.0.1:1", clientId: "maproulette-claim" });
    try {
      await expect(preview(T.partial)).rejects.toEqual(new ApiError(0, "network"));
    } finally {
      configure({ backend: mock.url, clientId: "maproulette-claim" });
    }
  });
});
