import { config } from "../config";

/** A suggested tag change: what people answered, and what OSM says now. */
export interface Suggestion {
  question: string;
  answer: string;
  /** The tags the answer sets, e.g. { door: "sliding" }. */
  tags: Record<string, string>;
  people: number;
  /** The day only (YYYY-MM-DD): no times, so the page can't show where a group was when. */
  day: string;
  /** The same keys as `tags`, as OSM has them now; null when not set. */
  current: Record<string, string | null>;
}

/** Answers that aren't a tag change. They never go into the MapRoulette queue (handback-copy §2). */
export interface Report {
  kind: "cant_tell" | "not_here" | "moved";
  people: number;
  day: string;
  /** For "moved": how far, and the reported spot. */
  meters?: number;
  lon?: number;
  lat?: number;
}

/** One place as `GET /api/v2/review/:token` sends it (Scala's H1a). No guest ids. */
export interface ReviewPlace {
  id: number;
  osm: { type: "node" | "way"; id: number };
  lon: number;
  lat: number;
  name?: string;
  ref?: string;
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
}

/** The page's link is /review/<token>, with the campaign's live page token. */
export function tokenFrom(pathname: string): string | undefined {
  return /^\/review\/([A-Za-z0-9_-]{43})\/?$/.exec(pathname)?.[1];
}

export type ReviewResult = { page: ReviewPage } | { problem: "missing" | "off" | "error" };

const auth = (bearer?: string): Record<string, string> => (bearer ? { Authorization: `Bearer ${bearer}` } : {});

/** The public read; with a bearer it also carries this mapper's skips. */
export async function fetchReview(token: string, bearer?: string): Promise<ReviewResult> {
  let res: Response;
  try {
    res = await fetch(`${config().backend}/api/v2/review/${token}`, { cache: "no-store", credentials: "omit", headers: auth(bearer) });
  } catch {
    return { problem: "error" };
  }
  if (res.status === 404) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { problem: body.error === "turned_off" ? "off" : "missing" };
  }
  if (!res.ok) return { problem: "error" };
  try {
    return { page: (await res.json()) as ReviewPage };
  } catch {
    return { problem: "error" };
  }
}

export class MarkError extends Error {
  constructor(readonly status: number) {
    super(`mark: HTTP ${status}`);
  }
}

/** Skip (for this mapper only) or Needs a visit, set or undone. Returns the updated place. */
export async function mark(token: string, placeId: number, what: "skip" | "needs-visit", on: boolean, bearer: string): Promise<ReviewPlace> {
  const res = await fetch(`${config().backend}/api/v2/review/${token}/places/${placeId}/${what}`, {
    method: on ? "PUT" : "DELETE",
    credentials: "omit",
    headers: auth(bearer),
  });
  if (!res.ok) throw new MarkError(res.status);
  return (await res.json()) as ReviewPlace;
}
