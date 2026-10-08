import type { Region, Rule } from "./jobs";

export const MAX_BOUNDARY_BYTES = 5 * 1024 * 1024;
export const MAX_VERTICES = 5000;
/** The service's default MAX_AREA_KM2; the service remains authoritative. */
export const WARN_AREA_KM2 = 5000;
export const MAX_RULES = 10;

export type Bbox = [south: number, west: number, north: number, east: number];
export type Geometry = Extract<Region, { type: "geojson" }>["geometry"];

export interface Area { region: Region; bbox: Bbox; areaKm2: number; vertices: number; warnings: string[] }

const R = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;
/** Area of a lat/long box on a sphere, km2. */
export function bboxAreaKm2([s, w, n, e]: Bbox): number {
  return Math.abs(R * R * rad(e - w) * (Math.sin(rad(n)) - Math.sin(rad(s))));
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates numeric south/west/north/east. Returns an Area or a list of problems. */
export function bboxArea(values: [unknown, unknown, unknown, unknown]): Area | string[] {
  const names = ["South", "West", "North", "East"];
  const nums = values.map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v));
  const problems: string[] = [];
  nums.forEach((v, i) => { if (!finite(v)) problems.push(`${names[i]} must be a number`); });
  if (problems.length) return problems;
  const [s, w, n, e] = nums as Bbox;
  if (s < -90 || n > 90) problems.push("Latitudes must be between -90 and 90");
  if (w < -180 || e > 180) problems.push("Longitudes must be between -180 and 180");
  if (s >= n) problems.push("South must be less than north");
  if (w >= e) problems.push("West must be less than east (areas crossing the antimeridian are not supported; use two jobs)");
  if (problems.length) return problems;
  const areaKm2 = bboxAreaKm2([s, w, n, e]);
  return { region: { type: "bbox", bbox: [s, w, n, e] }, bbox: [s, w, n, e], areaKm2, vertices: 4, warnings: areaWarnings(areaKm2) };
}

const areaWarnings = (km2: number) =>
  km2 > WARN_AREA_KM2 ? [`This area is about ${Math.round(km2).toLocaleString("en")} km2. The service rejects areas above its limit (default ${WARN_AREA_KM2} km2); queueing may fail.`] : [];

type Polygon = number[][][];

function checkPosition(p: unknown, where: string): [number, number] {
  if (!Array.isArray(p) || p.length < 2 || !finite(p[0]) || !finite(p[1])) throw new Error(`${where}: invalid position`);
  if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) throw new Error(`${where}: coordinates must be [longitude, latitude] within geographic bounds`);
  return [p[0], p[1]];
}

function checkPolygon(c: unknown, where: string): Polygon {
  if (!Array.isArray(c) || c.length < 1) throw new Error(`${where}: a polygon needs at least one ring`);
  return c.map((ring, i) => {
    if (!Array.isArray(ring) || ring.length < 4) throw new Error(`${where}: ring ${i + 1} needs at least 4 positions`);
    const pts = ring.map((p) => checkPosition(p, where));
    const a = pts[0]; const b = pts[pts.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) throw new Error(`${where}: ring ${i + 1} is not closed`);
    return pts;
  });
}

function collect(v: unknown, out: Polygon[], depth = 0): void {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("Expected a GeoJSON object");
  const o = v as { type?: unknown; coordinates?: unknown; geometry?: unknown; features?: unknown; geometries?: unknown };
  if (depth > 3) throw new Error("GeoJSON is nested too deeply");
  switch (o.type) {
    case "Polygon": out.push(checkPolygon(o.coordinates, "Polygon")); return;
    case "MultiPolygon":
      if (!Array.isArray(o.coordinates) || o.coordinates.length < 1) throw new Error("MultiPolygon: needs at least one polygon");
      for (const p of o.coordinates) out.push(checkPolygon(p, "MultiPolygon"));
      return;
    case "Feature": if (o.geometry == null) throw new Error("Feature has no geometry"); collect(o.geometry, out, depth + 1); return;
    case "FeatureCollection":
      if (!Array.isArray(o.features) || !o.features.length) throw new Error("FeatureCollection has no features");
      for (const f of o.features) collect(f, out, depth + 1);
      return;
    default: throw new Error(`Unsupported GeoJSON type ${String(o.type)}. Use a Polygon, MultiPolygon, Feature or FeatureCollection of polygons.`);
  }
}

/** Parses an area boundary file. Throws Error with a user-facing message. */
export function parseBoundary(text: string): Area {
  if (new TextEncoder().encode(text).length > MAX_BOUNDARY_BYTES) throw new Error(`Boundary file exceeds ${MAX_BOUNDARY_BYTES / 1024 / 1024} MiB. Simplify it first.`);
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error("The boundary file is not valid JSON."); }
  const polys: Polygon[] = [];
  collect(json, polys);
  const vertices = polys.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
  if (vertices > MAX_VERTICES) throw new Error(`The boundary has ${vertices.toLocaleString("en")} vertices; the limit is ${MAX_VERTICES.toLocaleString("en")}. Simplify it first.`);
  let s = 90; let w = 180; let n = -90; let e = -180;
  for (const p of polys) for (const ring of p) for (const [x, y] of ring) { s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x); }
  const geometry: Geometry = polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
  const bbox: Bbox = [s, w, n, e];
  const areaKm2 = bboxAreaKm2(bbox);
  return { region: { type: "geojson", geometry }, bbox, areaKm2, vertices, warnings: areaWarnings(areaKm2) };
}

/** One rule per object: the survey's identity tags are the starting point. */
export const rulesFromMatch = (match: unknown): string[] => {
  if (typeof match !== "object" || match === null || Array.isArray(match)) return [""];
  const lines = Object.entries(match).map(([k, v]) => `${k}=${String(v)}`);
  return [lines.join("\n")];
};

/** Parses editable rule text (one key=value per line, `*` for any value). */
export function parseRules(texts: string[]): { rules: Rule[]; problems: string[] } {
  const rules: Rule[] = []; const problems: string[] = [];
  texts.forEach((t, i) => {
    const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const rule: Rule = {};
    for (const line of lines) {
      const at = line.indexOf("=");
      const key = at > 0 ? line.slice(0, at).trim() : "";
      const value = at > 0 ? line.slice(at + 1).trim() : "";
      if (!key || !value) { problems.push(`Rule ${i + 1}: "${line}" must be key=value (use * for any value)`); continue; }
      if (Object.hasOwn(rule, key)) problems.push(`Rule ${i + 1}: key ${key} appears twice`);
      rule[key] = value;
    }
    rules.push(rule);
  });
  if (!rules.length) problems.push("Add at least one rule");
  if (rules.length > MAX_RULES) problems.push(`At most ${MAX_RULES} rules`);
  return { rules, problems };
}
