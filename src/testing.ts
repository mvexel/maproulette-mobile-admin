/**
 * Vitest helpers: runs src/auth.ts and src/api.ts in Node against the mock backend, with a
 * memory sessionStorage and a location whose assign() records the URL instead of navigating.
 */
import { vi } from "vitest";
import { type MockBackend, startMockBackend } from "../mock/server.ts";
import { clearSession, completeSignIn, startSignIn } from "./auth";
import { configure } from "./config";

export const APP_ORIGIN = "https://admin.test";

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

export const assign = vi.fn<(url: string) => void>();

export async function setUp(): Promise<MockBackend> {
  vi.stubGlobal("sessionStorage", new MemoryStorage());
  vi.stubGlobal("location", { origin: APP_ORIGIN, assign });
  const mock = await startMockBackend({ adminOrigin: APP_ORIGIN });
  configure({ backend: mock.url, clientId: "maproulette-mobile-admin" });
  return mock;
}

export function reset(mock: MockBackend) {
  clearSession();
  sessionStorage.clear();
  assign.mockClear();
  mock.reset();
}

export type MockUser = "super" | "plain" | "organizer";

/** Plays the browser on the last authorize URL the app went to: pick a user, follow the redirect back. */
export async function followAuthorize(mock: MockBackend, as: MockUser): Promise<URLSearchParams> {
  const authorize = assign.mock.calls.at(-1)?.[0];
  if (!authorize) throw new Error("startSignIn did not navigate");
  const page = await fetch(authorize);
  if (!page.ok) throw new Error(`authorize: HTTP ${page.status} ${await page.text()}`);
  const link = /href="([^"]+&as=(\w+))"/g;
  const html = await page.text();
  const decide = [...html.matchAll(link)].find((m) => m[2] === as)?.[1];
  if (!decide) throw new Error("no decision link");
  const back = await fetch(new URL(decide.replaceAll("&amp;", "&"), mock.url), { redirect: "manual" });
  const target = new URL(back.headers.get("location") ?? "");
  if (`${target.origin}${target.pathname}` !== `${APP_ORIGIN}/callback`) throw new Error(`redirected to ${target}`);
  return target.searchParams;
}

/** Starts a sign-in and plays the browser once. */
export async function browserSignIn(mock: MockBackend, as: MockUser): Promise<URLSearchParams> {
  await startSignIn();
  return followAuthorize(mock, as);
}

/** A full sign-in, including the organizer retry. */
export async function signIn(mock: MockBackend, as: MockUser = "super") {
  if ((await completeSignIn(await browserSignIn(mock, as))) === "retrying")
    await completeSignIn(await followAuthorize(mock, as));
}
