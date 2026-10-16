import type { QuestionSet, SetCount } from "./api";

/** The wizard's words (design/campaign-wizard.md §2). Iris signs off the copy. */

/** Step 1's radius chips: walking minutes, in metres. */
export const RADII = [
  { label: "5 min walk", metres: 400 },
  { label: "10 min", metres: 800 },
  { label: "15 min", metres: 1200 },
] as const;
export const DEFAULT_RADIUS = 800;
export const RADIUS_MIN = 200;
export const RADIUS_MAX = 3000;

/** "800 m" or "1.2 km". */
export const distance = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(Math.round(m / 100) / 10).toString()} km`);

const plural = (n: number, noun: { one: string; many: string }) => `${n} ${n === 1 ? noun.one : noun.many}`;

/** A card's count line: "23 to check here", "Nothing to check here" or "Count not available". */
export function countLine(c: SetCount | undefined): string {
  if (!c) return "Counting…";
  if ("unavailable" in c) return "Count not available";
  return c.open === 0 ? "Nothing to check here" : `${c.open} to check here`;
}

/** Cards by count, most first; unavailable counts after counted ones, sets with nothing last. */
export function bySetCount(sets: QuestionSet[], counts: Map<string, SetCount>): QuestionSet[] {
  const rank = (s: QuestionSet) => {
    const c = counts.get(s.id);
    if (!c) return -1;
    if ("unavailable" in c) return -2;
    return c.open === 0 ? -3 : c.open;
  };
  return [...sets].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

/** A set can be picked unless its count came back as zero. */
export const pickable = (c: SetCount | undefined) => !(c && !("unavailable" in c) && c.open === 0);

/**
 * "About 2 hours for 10 people. It can stay open after the event." when the set has more than one
 * evening's work for a group of ten (two hours); nothing otherwise. Never blocks.
 */
export function paceHint(open: number, set: QuestionSet, people = 10): string | undefined {
  const hours = open / (set.pace * people);
  if (hours <= 2) return undefined;
  return `About ${Math.round(hours)} hours for ${people} people. It can stay open after the event.`;
}

/** Step 3's line: "23 entrances to check. 41 are already complete, so we left them out." */
export function checkLine(open: number, complete: number, set: QuestionSet): string {
  const first = `${plural(open, set.noun)} to check.`;
  if (complete === 0) return first;
  return `${first} ${complete} ${complete === 1 ? "is" : "are"} already complete, so we left them out.`;
}

/** "Entrance doors around Woodbine Food Hall". */
export const draftName = (set: QuestionSet, place: string) => `${set.name} around ${place}`;

/** The set's description template, filled in. */
export const draftDescription = (set: QuestionSet, place: string) =>
  set.description.replaceAll("{place}", place).replaceAll("{nounMany}", set.noun.many).replaceAll("{audience}", set.audience);

/** "#StreetTallyWoodbineFoodHall": the place in CamelCase, letters and digits only, at most 40 characters. */
export function hashtag(place: string): string {
  const words = place.normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[A-Za-z0-9]+/g) ?? [];
  const camel = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  return `#StreetTally${camel}`.slice(0, 40);
}

/** The changeset comment mappers use when they add the answers (the review page suggests the same shape). */
export const changesetComment = (name: string, tag: string) => `From a Street Tally survey for ${name}. Checked by me. #StreetTally ${tag}`;

/** "10 November 2026"; the date only, never a time. */
export function eventDay(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The ready-to-paste invite (step 5), drafted here so the preview can show it. */
export function inviteText(set: QuestionSet, place: string, link: string, isoDay?: string): string {
  const when = isoDay ? ` on ${eventDay(isoDay)}` : "";
  return `Join us at ${place}${when} to check ${set.noun.many} for Street Tally. No account needed, just your phone: ${link}`;
}
