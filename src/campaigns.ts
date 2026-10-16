import type { Campaign, QueueReport } from "./api";
import { participantSite } from "./config";

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
export const webLink = (id: number) => `${participantSite()}/challenge/${id}`;
/** The campaign's live progress page on the participant site. */
export const liveLink = (token: string) => `${participantSite()}/live/${token}`;

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a confirm queue run did, as one line; zero counts are left out. */
export function queueSummary(r: QueueReport): string {
  const parts = [
    `${count(r.queued, "suggestion")} added`,
    r.alreadyQueued > 0 && `${r.alreadyQueued} already in the queue`,
    r.done > 0 && `${r.done} already on the map`,
    r.stale > 0 && `${count(r.stale, "place")} changed on OSM since the survey`,
    r.gone > 0 && `${count(r.gone, "place")} deleted from OSM`,
    r.disagree > 0 && `${count(r.disagree, "question")} where people gave different answers`,
  ].filter(Boolean);
  return `${parts.join(" · ")}.`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant as a `datetime-local` input value, in local time to the minute. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value (local time) as an ISO 8601 instant; undefined when it isn't one. */
export function fromLocalInput(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
