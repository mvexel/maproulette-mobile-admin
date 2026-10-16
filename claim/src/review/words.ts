import { plural } from "../live/words";
import type { Report, ReviewPage, ReviewPlace, Suggestion } from "./api";

/** The review page's words (design/handback-copy.md §2). */

/** "47 answers to review · 12 added · 3 need a visit". */
export function countsLine(p: ReviewPage): string {
  const c = p.counts;
  return [
    `${plural(c.toReview, "answer", "answers")} to review`,
    `${c.added} added`,
    `${c.needsVisit} ${c.needsVisit === 1 ? "needs" : "need"} a visit`,
  ].join(" · ");
}

/** "14 Oct": the day only, never a time. */
export function shortDay(isoDay: string): string {
  return new Date(`${isoDay.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export const tagText = (tags: Record<string, string>) =>
  Object.entries(tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(" · ");

/** "2 people, 14 Oct". */
export const whoLine = (x: { people: number; day: string }) => `${plural(x.people, "person", "people")}, ${shortDay(x.day)}`;

/** "On OSM now: not set", or what it has. */
export function currentLine(s: Suggestion): string {
  const set = Object.entries(s.current).filter((e): e is [string, string] => e[1] !== null);
  return `On OSM now: ${set.length ? set.map(([k, v]) => `${k}=${v}`).join(" · ") : "not set"}`;
}

/** The campaign's own label; the outcome id is only a fallback. */
export const reportText = (r: Report) => r.label || r.outcome;

/** Only "not here" or "moved" answers: a look on the ground, never a tag change. */
export const needsLook = (p: ReviewPlace) => p.suggestions.length === 0;

/** The "2 people agree" filter: a filter, not a gate (handback-copy §2). */
export const agreed = (p: ReviewPlace) => p.suggestions.some((s) => s.people >= 2);

export type Filter = "all" | "agree" | "visit" | "done";

export function shown(p: ReviewPlace, f: Filter): boolean {
  if (f === "agree") return p.state === "open" && agreed(p);
  if (f === "visit") return p.state === "needs_visit";
  if (f === "done") return p.state === "done";
  return true;
}

export function stateLabel(p: ReviewPlace): string | undefined {
  if (p.state === "done") return "On the map";
  if (p.state === "needs_visit") return "Needs a visit";
  if (needsLook(p)) return "Needs a look";
  return undefined;
}

/**
 * JOSM remote control: loads the object and pre-fills the suggested tags for the mapper to check.
 * A place that only needs a look loads without tags.
 */
export function josmUrl(p: ReviewPlace): string {
  const q = new URLSearchParams({ new_layer: "false", objects: `${p.osm.type === "way" ? "w" : "n"}${p.osm.id}` });
  const tags = p.suggestions.flatMap((s) => Object.entries(s.tags).map(([k, v]) => `${k}=${v}`));
  if (tags.length) q.set("addtags", tags.join("|"));
  return `http://127.0.0.1:8111/load_object?${q}`;
}

/** iD selects the object only: it can't pre-fill tags from a link. */
export const idUrl = (p: ReviewPlace, osmWeb: string) => `${osmWeb}/edit?editor=id&${p.osm.type}=${p.osm.id}`;

/** The suggested changeset comment; the server's when it sends one. */
export function changesetComment(p: ReviewPage): string {
  if (p.campaign.changesetComment) return p.campaign.changesetComment;
  const days = [...new Set(p.places.flatMap((x) => x.suggestions.map((s) => s.day.slice(0, 10))))].sort();
  const when = days.length ? `, ${days.length === 1 ? shortDay(days[0]) : `${shortDay(days[0])} to ${shortDay(days[days.length - 1])}`}` : "";
  const tags = ["#StreetTally", ...p.campaign.hashtags.filter((h) => h !== "#StreetTally")].join(" ");
  return `From a Street Tally survey for ${p.campaign.name}${when}. Checked by me. ${tags}`;
}
