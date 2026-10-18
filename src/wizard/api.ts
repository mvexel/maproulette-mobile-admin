import type { MultiPolygon, Polygon } from "geojson";
import { ApiError, api } from "../api";
import { config } from "../config";

/** The campaign wizard's endpoints under /api/v2/mobile-admin/wizard (backend #48; design/wizard/wizard-api-draft.md). */

export interface QuestionSet {
  id: string;
  version: number;
  name: string;
  /** The card's "why it matters" line. */
  why: string;
  /** Who it helps, for the drafted description: "wheelchair, stroller and walker users". */
  audience: string;
  noun: { one: string; many: string };
  /** One question from the set, shown on its card. */
  example: string;
  /** Features one participant checks in an hour. */
  pace: number;
  /** Iris's description template: {place}, {nounMany} and {audience} are filled in. */
  description: string;
  /** Every question participants answer, in their wording and order (W-EASY L4); absent from older backends. */
  questions?: SetQuestion[];
}

/** A set's question as participants see it: the survey's question without its tags. */
export interface SetQuestion {
  id: string;
  prompt: string;
  description?: string;
  options: { id: string; label: string }[];
}

/** Where the wizard's extract has features (backend #61). `extract` is null until one is loaded. */
export interface Coverage {
  extract: {
    source: string;
    extractAt: string;
    loadedAt: string;
    features: number;
    /** False once the extract is older than `maxAgeHours`. */
    fresh: boolean;
    maxAgeHours: number;
    bbox: [number, number, number, number];
    coverage: Polygon | MultiPolygon;
  } | null;
}

export type SetCount = { set: string; version: number; open: number; complete: number } | { set: string; version: number; unavailable: true };

export interface Area {
  lat: number;
  lon: number;
  /** Metres, 200 to 3000. */
  radius: number;
}

export interface OpenFeature {
  /** "node/123" or "way/456". */
  id: string;
  lon: number;
  lat: number;
  name: string | null;
}

export interface SetFeatures {
  set: string;
  version: number;
  complete: number;
  truncated: boolean;
  open: OpenFeature[];
}

const ORGANIZE = "/api/v2/mobile-admin/wizard";
const areaQuery = (a: Area) => new URLSearchParams({ lat: a.lat.toFixed(6), lon: a.lon.toFixed(6), radius: String(Math.round(a.radius)) });

export const questionSets = async () => (await api<{ sets: QuestionSet[] }>(`${ORGANIZE}/question-sets`)).sets;
export const countSets = async (a: Area) => (await api<{ counts: SetCount[] }>(`${ORGANIZE}/counts?${areaQuery(a)}`)).counts;
export const coverage = () => api<Coverage>(`${ORGANIZE}/coverage`);
export const setFeatures = (set: string, a: Area) => api<SetFeatures>(`${ORGANIZE}/question-sets/${encodeURIComponent(set)}/features?${areaQuery(a)}`);

/** What the admin sends to create a campaign. The server re-queries the features and drops `leaveOut`. */
export interface NewCampaign {
  /** The project it goes in; the server checks the caller may run campaigns there. */
  projectId: number;
  set: string;
  version: number;
  area: Area & { place: string };
  leaveOut: string[];
  name: string;
  description: string;
  eventDate?: string;
}

export interface CreatedCampaign {
  /** The challenge id; the campaign is a draft until published. */
  id: number;
  /** Tasks created: the open features in the area, less the ones left out. */
  tasks: number;
}

/** Creates the campaign as a draft. A 409 `set_changed` means `version` is no longer current. */
export const createCampaign = (c: NewCampaign) => api<CreatedCampaign>(`${ORGANIZE}/campaigns`, { method: "POST", body: JSON.stringify(c) });
/** `listed` is false while the project is off; publishing never turns a project on. */
export const publishCampaign = (id: number) => api<{ id: number; published: true; listed: boolean }>(`${ORGANIZE}/campaigns/${id}/publish`, { method: "POST" });

/** A place search result. */
export interface Place {
  /** The short name for the drafted words: "Woodbine Food Hall". */
  name: string;
  /** The full line shown in the result list. */
  label: string;
  lat: number;
  lon: number;
}

/**
 * Nominatim search, one request per Search press (its usage policy: light use, no autocomplete).
 * The page's Referrer-Policy is no-referrer (Caddy's common block), so this request asks for the admin's
 * origin as the referrer: their policy needs a Referer or User-Agent that identifies us, and a browser
 * can't set the User-Agent.
 */
export async function searchPlaces(q: string): Promise<Place[]> {
  const url = `${config().geocoder}/search?${new URLSearchParams({ q, format: "jsonv2", limit: "5", addressdetails: "0" })}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, referrerPolicy: "origin" });
  } catch {
    throw new ApiError(0, "network");
  }
  if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
  const rows = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
  return rows.map((r) => ({
    name: r.name || r.display_name.split(",")[0].trim(),
    label: r.display_name,
    lat: Number(r.lat),
    lon: Number(r.lon),
  }));
}
