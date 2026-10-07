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

/** Plays the browser: authorize, pick a user on the mock page, follow the redirect back. */
export async function browserSignIn(mock: MockBackend, as: "super" | "plain"): Promise<URLSearchParams> {
  await startSignIn();
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

export async function signIn(mock: MockBackend) {
  await completeSignIn(await browserSignIn(mock, "super"));
}
