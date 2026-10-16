import { config } from "../config";

/** A suggested tag change: what people answered, and what OSM says now. */
export interface Suggestion {
  /** The question and option ids; `label` is the answer as people saw it. */
  question: string;
  answer: string;
  label: string;
  /** The tags the answer sets, e.g. { door: "sliding" }. */
  tags: Record<string, string>;
  people: number;
  /** The UTC day of the most recent of these answers (YYYY-MM-DD): no times. */
  day: string;
  /** The same keys as `tags`, as OSM has them now; null when not set. */
  current: Record<string, string | null>;
}

/**
 * Answers that aren't a tag change, such as "It's not here". The outcome ids are the campaign's own,
 * so the page shows `label`. They never go into the MapRoulette queue (handback-copy §2).
 */
export interface Report {
  outcome: string;
  label: string;
  people: number;
  day: string;
  /** Only when the guest gave a spot. */
  lon?: number;
  lat?: number;
}

/** One place as `GET /api/v2/review/:token` sends it (Scala's H1a). No guest ids. */
export interface ReviewPlace {
  id: number;
  osm: { type: "node" | "way"; id: number };
  lon: number;
  lat: number;
  name?: string | null;
  ref?: string | null;
  /** "done" is set by the server once OSM carries the tag, whoever added it. */
  state: "open" | "done" | "needs_visit";
  /** Only with a signed-in read: this mapper skipped it. */
  skipped?: boolean;
  suggestions: Suggestion[];
  reports: Report[];
}

export interface ReviewPage {
  campaign: { name: string; hashtags: string[]; match?: Record<string, string>; changesetComment?: string };
  counts: { toReview: number; added: number; needsVisit: number };
  places: ReviewPlace[];
  /** Set while more places remain: pass it as `after`. */
  next?: number;
}

/** The page's link is /review/<token>, with the campaign's live page token. */
export function tokenFrom(pathname: string): string | undefined {
  return /^\/review\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1];
}

export type ReviewResult = { page: ReviewPage } | { problem: "missing" | "off" | "error" };

const auth = (bearer?: string): Record<string, string> => (bearer ? { Authorization: `Bearer ${bearer}` } : {});

const PAGES = 20; // 20 × 200 places is plenty for one campaign

/** The public read, all pages of it; with a bearer it also carries this mapper's skips. */
export async function fetchReview(token: string, bearer?: string): Promise<ReviewResult> {
  let all: ReviewPage | undefined;
  let after: number | undefined;
  for (let i = 0; i < PAGES; i++) {
    const q = new URLSearchParams({ limit: "200", ...(after === undefined ? {} : { after: String(after) }) });
    let res: Response;
    try {
      res = await fetch(`${config().backend}/api/v2/review/${token}?${q}`, { cache: "no-store", credentials: "omit", headers: auth(bearer) });
    } catch {
      return { problem: "error" };
    }
    if (res.status === 404) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { problem: body.error === "turned_off" ? "off" : "missing" };
    }
    if (!res.ok) return { problem: "error" };
    let page: ReviewPage;
    try {
      page = (await res.json()) as ReviewPage;
    } catch {
      return { problem: "error" };
    }
    all = all ? { ...page, places: [...all.places, ...page.places] } : page;
    if (page.next === undefined || page.next === null) break;
    after = page.next;
  }
  return all ? { page: all } : { problem: "error" };
}

export class MarkError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`mark: HTTP ${status}${code ? ` ${code}` : ""}`);
  }
}

/** Skip (for this mapper only) or Needs a visit, set or undone. Returns the updated place. */
export async function mark(token: string, placeId: number, what: "skip" | "needs-visit", on: boolean, bearer: string): Promise<ReviewPlace> {
  const res = await fetch(`${config().backend}/api/v2/review/${token}/places/${placeId}/${what}`, {
    method: on ? "PUT" : "DELETE",
    credentials: "omit",
    headers: auth(bearer),
  });
  if (!res.ok) throw new MarkError(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error);
  return (await res.json()) as ReviewPlace;
}
