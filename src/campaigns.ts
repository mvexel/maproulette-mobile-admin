import type { Campaign } from "./api";

/** Where a campaign stands in the app (design pass §2). */
export type AppState = "listed" | "project-off" | "turned-off" | "not-published" | "draft";

export function appState(c: Pick<Campaign, "enabled" | "published" | "listed" | "project">): AppState {
  if (c.listed) return "listed";
  if (c.enabled && c.published) return "project-off";
  if (c.published) return "turned-off";
  if (c.enabled) return "not-published";
  return "draft";
}

export const STATE_LABEL: Record<AppState, string> = {
  listed: "Listed",
  "project-off": "Hidden: project off",
  "turned-off": "Hidden: challenge off",
  "not-published": "Hidden: not published",
  draft: "Draft",
};

export const projectName = (p: Campaign["project"]) => p.displayName || p.name;

/** "12 of 28 checked · 2 need another look", the app's and live page's rule. */
export function progressText(t: Campaign["tasks"]): string {
  const look = t.needsLook === 0 ? "" : ` · ${t.needsLook} ${t.needsLook === 1 ? "needs" : "need"} another look`;
  return `${t.checked} of ${t.total} checked${look}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86400],
  ["month", 30 * 86400],
  ["week", 7 * 86400],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago", "yesterday"; "just now" under a minute. */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = (Date.parse(iso) - now) / 1000;
  if (Number.isNaN(seconds)) return "";
  const fmt = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, size] of UNITS)
    if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
  return "just now";
}

/** The app's custom-scheme link; opens the campaign in an installed app. */
export const appLink = (id: number) => `mrchoice://challenge/${id}`;
/** The universal link; opens the app only once the App Store build exists. */
export const webLink = (id: number) => `https://streettally.osm.lol/challenge/${id}`;
