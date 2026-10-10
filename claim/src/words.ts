import type { Preview } from "./api";

/** "1 stop" / "14 stops". The preview may name the campaign's places; otherwise "places". */
export function count(n: number, preview?: Pick<Preview, "noun">): string {
  const noun = preview?.noun ?? { one: "place", many: "places" };
  return `${n} ${n === 1 ? noun.one : noun.many}`;
}

/** "6 had no shelter · 3 had no bench", from the questions where someone answered "no". */
export function found(preview: Preview): string | undefined {
  const parts = preview.summary
    .filter((q) => (q.counts.no ?? 0) > 0)
    .sort((a, b) => (b.counts.no ?? 0) - (a.counts.no ?? 0))
    .map((q) => `${q.counts.no} had no ${q.label.toLowerCase()}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** A short, local date like "Nov 30". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
