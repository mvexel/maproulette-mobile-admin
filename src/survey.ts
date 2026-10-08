import type { ChallengeDraft } from "./api";

export interface SurveyOption {
  id: string;
  label: string;
  description?: string;
  setTags?: Record<string, string>;
  unsetTags?: string[];
}
export interface SurveyQuestion {
  id: string;
  prompt: string;
  description?: string;
  expect: Record<string, string | null>;
  options: SurveyOption[];
}
export interface SurveyFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: Record<string, string> & { "@id": string };
}
/** Portable authoring source. No backend IDs or credentials: import always creates a new challenge. */
export interface SurveyDocument {
  version: 1;
  challenge: ChallengeDraft;
  match: Record<string, string>;
  questions: SurveyQuestion[];
  features: { type: "FeatureCollection"; features: SurveyFeature[] };
}
export class SurveyValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.join("\n"));
    this.problems = problems;
  }
}
const identifier = /^[a-z0-9][a-z0-9-]{0,31}$(?![\s\S])/;
const element = /^(node|way|relation)\/[1-9][0-9]{0,15}$(?![\s\S])/;
const size = (s: string) => [...s].length;
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const tag = (v: unknown): v is string => typeof v === "string" && size(v) >= 1 && size(v) <= 255 && !Array.from(v).some(c => { const n = c.charCodeAt(0); return n < 32 || (n >= 127 && n <= 159); });

/** Mirrors the existing backend's v1 bounds; backend validation remains authoritative. */
export function parseSurvey(value: unknown): SurveyDocument {
  const errors: string[] = [];
  const fail = (s: string) => errors.push(s);
  const obj = (v: unknown, path: string, keys?: string[]) => {
    if (!object(v)) { fail(`${path}: must be an object`); return {}; }
    if (keys) for (const key of Object.keys(v)) if (!keys.includes(key)) fail(`${path}: unknown field ${key}`);
    return v;
  };
  const text = (v: unknown, path: string, max: number, optional = false) => {
    if (optional && v === undefined) return undefined;
    if (typeof v !== "string" || size(v) < 1 || size(v) > max) fail(`${path}: needs 1–${max} characters`);
    return typeof v === "string" ? v : "";
  };
  const id = (v: unknown, path: string) => {
    if (typeof v !== "string" || !identifier.test(v)) fail(`${path}: use 1–32 lowercase letters, digits or hyphens, starting with a letter or digit`);
    return typeof v === "string" ? v : "";
  };
  const tags = (v: unknown, path: string, nullable = false) => {
    const o = obj(v, path);
    for (const [k, val] of Object.entries(o)) if (!tag(k) || !(tag(val) || (nullable && val === null))) fail(`${path}.${k}: invalid OSM tag`);
    return o;
  };
  const list = (v: unknown, path: string, min: number, max: number): unknown[] => {
    if (!Array.isArray(v)) { fail(`${path}: must be an array`); return []; }
    if (v.length < min || v.length > max) fail(`${path}: needs ${min}–${max} entries`);
    return v;
  };
  const unique = (ids: string[], path: string) => { if (new Set(ids).size !== ids.length) fail(`${path}: duplicate IDs`); };
  const root = obj(value, "survey", ["version", "challenge", "match", "questions", "features"]);
  if (root.version !== 1) fail("survey.version: only version 1 is supported");
  const c = obj(root.challenge, "challenge", ["name", "description", "instruction", "checkinComment", "checkinSource"]);
  for (const k of ["name", "description", "instruction", "checkinComment", "checkinSource"]) text(c[k], `challenge.${k}`, k === "name" ? 100 : 2000);
  const match = tags(root.match, "match");
  if (Object.keys(match).length > 4) fail("match: at most 4 identity tags");
  const guarded: string[] = [];
  const questions = list(root.questions, "questions", 1, 8).map((qv, qi) => {
    const path = `Question ${qi + 1}`;
    const q = obj(qv, path, ["id", "prompt", "description", "expect", "options"]);
    id(q.id, `${path}.id`); text(q.prompt, `${path}.prompt`, 200); text(q.description, `${path}.description`, 500, true);
    const expect = tags(q.expect, `${path}.expect`, true);
    const keys = Object.keys(expect);
    if (keys.length < 1 || keys.length > 4) fail(`${path}.expect: needs 1–4 guarded tags`);
    guarded.push(...keys);
    const options = list(q.options, `${path}.options`, 2, 12).map((ov, oi) => {
      const opath = `${path}, option ${oi + 1}`;
      const o = obj(ov, opath, ["id", "label", "description", "setTags", "unsetTags"]);
      id(o.id, `${opath}.id`); text(o.label, `${opath}.label`, 60); text(o.description, `${opath}.description`, 300, true);
      const set = o.setTags === undefined ? {} : tags(o.setTags, `${opath}.setTags`);
      const unset = o.unsetTags === undefined ? [] : list(o.unsetTags, `${opath}.unsetTags`, 1, 4);
      if (o.setTags !== undefined && Object.keys(set).length === 0) fail(`${opath}.setTags: must not be empty`);
      if (new Set(unset).size !== unset.length) fail(`${opath}: duplicate removed tags`);
      for (const k of unset) if (!tag(k)) fail(`${opath}: invalid removed tag`);
      const changed = [...Object.keys(set), ...unset.filter((k): k is string => typeof k === "string")];
      if (!changed.length) fail(`${opath}: define a tag change`);
      for (const k of changed) if (!Object.hasOwn(expect, k)) fail(`${opath}: ${k} is not guarded by this question`);
      for (const k of unset) if (typeof k === "string" && Object.hasOwn(set, k)) fail(`${opath}: ${k} is both set and removed`);
      if (changed.length && changed.every(k => Object.hasOwn(set, k) ? set[k] === expect[k] : expect[k] === null)) fail(`${opath}: the answer would not change any tags`);
      return o;
    });
    unique(options.map(o => String(o.id)), `${path}.options`);
    return q;
  });
  unique(questions.map(q => String(q.id)), "questions");
  if (new Set(guarded).size !== guarded.length) fail("questions: a tag must be guarded by only one question");
  for (const k of guarded) if (Object.hasOwn(match, k)) fail(`match: ${k} is also guarded by a question`);
  const fc = obj(root.features, "features", ["type", "features"]);
  if (fc.type !== "FeatureCollection") fail("features: expected a GeoJSON FeatureCollection");
  const features = list(fc.features, "features.features", 1, 10000).map((fv, i) => {
    const path = `Feature ${i + 1}`;
    const f = obj(fv, path, ["type", "geometry", "properties"]);
    if (f.type !== "Feature") fail(`${path}: expected a GeoJSON Feature`);
    const g = obj(f.geometry, `${path}.geometry`, ["type", "coordinates"]);
    if (g.type !== "Point") fail(`${path}: supply a representative Point location`);
    const coords = list(g.coordinates, `${path}.coordinates`, 2, 2);
    if (typeof coords[0] !== "number" || !Number.isFinite(coords[0]) || Math.abs(coords[0]) > 180 || typeof coords[1] !== "number" || !Number.isFinite(coords[1]) || Math.abs(coords[1]) > 90) fail(`${path}: coordinates must be finite [longitude, latitude] within geographic bounds`);
    const p = obj(f.properties, `${path}.properties`);
    if (typeof p["@id"] !== "string" || !element.test(p["@id"])) fail(`${path}: properties.@id needs node/ID, way/ID or relation/ID`);
    for (const [k, v] of Object.entries(p)) if (k !== "@id" && (!tag(k) || !tag(v))) fail(`${path}.${k}: properties must be OSM tag strings`);
    return f;
  });
  unique(features.map(f => String(object(f.properties) ? f.properties["@id"] : "")), "features");
  if (errors.length) throw new SurveyValidationError(errors);
  return value as SurveyDocument;
}

export function generateTasks(input: SurveyDocument) {
  const survey = parseSurvey(input);
  const skipped: string[] = [];
  const lines: string[] = [];
  for (const f of survey.features.features) {
    const featureId = f.properties["@id"];
    if (!Object.entries(survey.match).every(([k, v]) => f.properties[k] === v)) {
      skipped.push(`${featureId}: identity tags do not match`); continue;
    }
    const questions = survey.questions.filter(q => Object.entries(q.expect).every(([k, v]) => (Object.hasOwn(f.properties, k) ? f.properties[k] : null) === v));
    if (!questions.length) { skipped.push(`${featureId}: no applicable questions`); continue; }
    const work = {
      meta: { version: 2, type: 3, choiceVersion: 1 }, element: featureId,
      ...(Object.keys(survey.match).length ? { match: survey.match } : {}), questions,
      ...(questions.every(q => Object.values(q.expect).every(v => v === null)) ? { liveMissingQuestions: true } : {}),
    };
    if (new TextEncoder().encode(JSON.stringify(work)).length > 16384) throw new SurveyValidationError([`${featureId}: choice payload exceeds the backend's 16 KiB limit`]);
    lines.push(JSON.stringify({ type: "FeatureCollection", features: [f], cooperativeWork: work }));
  }
  return { text: lines.join("\n") + (lines.length ? "\n" : ""), count: lines.length, skipped };
}

export function exampleSurvey(kind: "restaurant" | "bus-stop"): SurveyDocument {
  const restaurant = kind === "restaurant";
  const specs = restaurant ? [
    ["outdoor-seating", "outdoor_seating", "Is outdoor seating available?", "Look for seating provided by this restaurant outdoors. Public benches nearby do not count."],
    ["takeaway", "takeaway", "Can you order food to take away?", "Check the menu or signs, or ask staff. If you cannot confirm either way, choose I can't tell."],
    ["delivery", "delivery", "Does this restaurant offer delivery?", "Check advertised delivery services or ask staff. Absence of a sign does not mean No."],
    ["toilets", "toilets", "Are toilets available for customers?", "Check customer facilities or ask staff. Do not enter staff-only areas."],
  ] : [["shelter", "shelter", "Is there a shelter at this stop?", "Look for a roof that passengers can wait under."]];
  return {
    version: 1,
    challenge: { name: restaurant ? "Restaurant details" : "Bus stop details", description: restaurant ? "Help people know what to expect before visiting a restaurant." : "Help people know what to expect at their bus stop.", instruction: "Visit the mapped feature and answer only what you can confirm. Choose I can't tell if you are unsure.", checkinComment: restaurant ? "Survey restaurant details #maproulette" : "Survey bus stop details #maproulette", checkinSource: "survey" },
    match: restaurant ? { amenity: "restaurant" } : { highway: "bus_stop" },
    questions: specs.map(([id, key, prompt, description]) => ({ id, prompt, description, expect: { [key]: null }, options: [
      { id: "yes", label: "Yes", setTags: { [key]: "yes" } },
      { id: "no", label: "No", setTags: { [key]: "no" } },
    ] })),
    features: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [-111.891, 40.7608] }, properties: { "@id": "node/9999999999999999", ...(restaurant ? { amenity: "restaurant" } : { highway: "bus_stop" }) } }] },
  };
}
