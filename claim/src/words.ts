import type { Preview } from "./api";

type Noun = Preview["campaign"]["noun"];
const PLACES: Noun = { one: "place", other: "places" };

/** "1 stop" / "14 stops", with the campaign's noun (the backend defaults to place/places). */
export function count(n: number, noun: Noun = PLACES): string {
  return `${n} ${n === 1 ? noun.one : noun.other}`;
}

/** "6 had no shelter · 3 had no bench", from the questions where someone answered "no", most first. */
export function found(preview: Pick<Preview, "found" | "summary">): string | undefined {
  const label = (id: string, prompt: string) => preview.summary.find((q) => q.questionId === id)?.label ?? prompt;
  const parts = [...preview.found]
    .filter((q) => q.noCount > 0)
    .sort((a, b) => b.noCount - a.noCount)
    .map((q) => `${q.noCount} had no ${label(q.questionId, q.prompt).toLowerCase()}`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** A short, local date like "Nov 30". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whether a claimed token's claim stopped short and the participant can finish it by signing in. */
export function needsSignIn(claim: Preview["claim"]): boolean {
  return !!claim && (claim.state === "reauth_required" || claim.state === "failed" || (claim.state === "partial" && claim.counts.failed > 0));
}
