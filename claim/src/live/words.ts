import type { LivePage, LiveStop } from "./api";

export interface Noun {
  one: string;
  many: string;
}

const PLACE: Noun = { one: "place", many: "places" };

/**
 * Identity tags to nouns, the same table as the apps (iOS `Campaign/Wording.swift`, Android
 * `campaign/Wording.kt`). A null value matches any value, as `entrance=*` does on Android.
 */
const KNOWN: [string, string | null, Noun][] = [
  ["highway", "bus_stop", { one: "stop", many: "stops" }],
  ["public_transport", "platform", { one: "stop", many: "stops" }],
  ["railway", "platform", { one: "platform", many: "platforms" }],
  ["amenity", "bench", { one: "bench", many: "benches" }],
  ["amenity", "bicycle_parking", { one: "bike rack", many: "bike racks" }],
  ["amenity", "waste_basket", { one: "trash can", many: "trash cans" }],
  ["amenity", "drinking_water", { one: "water fountain", many: "water fountains" }],
  ["amenity", "toilets", { one: "restroom", many: "restrooms" }],
  ["amenity", "shelter", { one: "shelter", many: "shelters" }],
  ["leisure", "playground", { one: "playground", many: "playgrounds" }],
  ["leisure", "park", { one: "park", many: "parks" }],
  ["entrance", null, { one: "entrance", many: "entrances" }],
];

/** What the campaign's places are called, from the first task's identity guard. */
export function noun(match: Record<string, string>): Noun {
  return KNOWN.find(([k, v]) => k in match && (v === null || match[k] === v))?.[2] ?? PLACE;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The stop label rule from the apps: name, else "<Noun> <ref>", else "<Noun>". */
export function label(stop: Pick<LiveStop, "name" | "ref">, n: Noun): string {
  const One = n.one.charAt(0).toUpperCase() + n.one.slice(1);
  return stop.name ?? (stop.ref ? `${One} ${stop.ref}` : One);
}

/** "18 October", or "18 October 2026" with the year. */
export function day(iso: string, year = false): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(year ? { year: "numeric" } : {}) });
}

/**
 * Coarse on purpose (design/live-progress-review.md L8): exact minutes would show roughly where a
 * group is right now. "in the last 15 min", "20 min ago" (rounded to 5), "1 h ago".
 */
export function ago(minutes: number): string {
  if (minutes < 15) return "in the last 15 min";
  if (minutes < 60) return `${Math.round(minutes / 5) * 5} min ago`;
  return `${Math.floor(minutes / 60)} h ago`;
}

/** Minutes between a stop's time and the response's time, so the viewer's clock doesn't matter. */
export function minutesSince(at: string, page: Pick<LivePage, "generatedAt">, elapsedMs = 0): number {
  return Math.max(0, (Date.parse(page.generatedAt) + elapsedMs - Date.parse(at)) / 60000);
}

/** Recently checked (pulse ring): checked in the last 10 minutes, while live. */
export function recent(stop: LiveStop, page: LivePage): boolean {
  return page.mode === "live" && stop.state === "checked" && !!stop.at && minutesSince(stop.at, page) <= 10;
}

/** The header's first line: "The tally: 9 of 16 entrances checked". */
export function tallyLine(page: LivePage, n: Noun): { checked: number; rest: string } {
  return { checked: page.tally.checked, rest: ` of ${plural(page.tally.total, n.one, n.many)} checked` };
}

/** The header's second line (review L3): plurals, no "0 need another look" while live. */
export function subLine(page: LivePage): string {
  const parts: string[] = [];
  const ended = page.mode === "ended";
  if (ended && page.endedAt) parts.push(`Surveyed ${day(page.endedAt, true)}`);
  const look = page.tally.needsLook;
  if (look) parts.push(`${look} ${look === 1 ? "needs" : "need"} another look`);
  else if (ended) parts.push("None need another look");
  if (!ended && page.tally.people !== undefined) parts.push(`${plural(page.tally.people, "person", "people")} tonight`);
  return parts.join(" · ");
}

export const STATE_LABEL: Record<LiveStop["state"], string> = {
  todo: "To check",
  checked: "Checked",
  look: "Needs another look",
};

/** The tap card's time line. Ended pages give the date instead (review L4). */
export function when(stop: LiveStop, page: LivePage, elapsedMs = 0): string | undefined {
  if (!stop.at || stop.state === "todo") return undefined;
  const time = page.mode === "ended" ? `on ${day(stop.at)}` : ago(minutesSince(stop.at, page, elapsedMs));
  return stop.state === "look" ? `Someone couldn't check it ${time}` : `Checked ${time}`;
}
