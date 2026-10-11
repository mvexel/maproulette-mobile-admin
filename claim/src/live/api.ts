import { config } from "../config";

/** One stop as `GET /api/v2/live/:token` sends it (backend docs/mobile-admin-api.md). */
export interface LiveStop {
  id: number;
  lon: number;
  lat: number;
  state: "todo" | "checked" | "look";
  name?: string;
  ref?: string;
  /** When it was checked or reported, cut to the minute. */
  at?: string;
  /** Only when the page shows answers. */
  answers?: { question: string; answer: string }[];
  reported?: string;
}

export interface LivePage {
  campaign: { name: string; hashtags: string[]; match: Record<string, string> };
  mode: "live" | "ended";
  answersShown: boolean;
  generatedAt: string;
  endedAt?: string;
  tally: { checked: number; total: number; needsLook: number; people?: number };
  stops: LiveStop[];
}

/** The page's link is /live/<token>. */
export function tokenFrom(pathname: string): string | undefined {
  return /^\/live\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1];
}

/** "missing": unknown or replaced link. "off": the organizer turned it off. "error": try again. */
export type LiveResult = { page: LivePage } | { problem: "missing" | "off" | "error" };

export async function fetchLive(token: string): Promise<LiveResult> {
  let res: Response;
  try {
    res = await fetch(`${config().backend}/api/v2/live/${token}`, { cache: "no-store", credentials: "omit" });
  } catch {
    return { problem: "error" };
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { problem: body.error === "turned_off" ? "off" : "missing" };
  }
  if (!res.ok) return { problem: "error" };
  try {
    return { page: (await res.json()) as LivePage };
  } catch {
    return { problem: "error" };
  }
}
