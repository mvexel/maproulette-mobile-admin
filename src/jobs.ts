import { authedFetch } from "./api";
import { config } from "./config";

export type JobState =
  | "queued" | "submitting" | "slicing" | "downloading" | "converting"
  | "complete" | "failed" | "cancelled" | "expired";

export type Region =
  | { type: "bbox"; bbox: [south: number, west: number, north: number, east: number] }
  | { type: "geojson"; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } };

export type Rule = Record<string, string>;

export interface JobResult {
  featureCount: number;
  counts: { candidates: number; emitted: number; duplicates: number; outside_region: number; omitted: number };
  omissions: { id: string; reason: string; detail: string }[];
  omissionTotal: number;
  provenance: {
    sliceosmJobId: string; sourceTimestamp: string | null; pbfSha256: string; pbfBytes: number;
    request: unknown; rules: Rule[]; createdAt: string;
  };
}

export interface Job {
  id: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  input: { region: Region; rules: Rule[]; name: string };
  progress: { stage: string; fraction: number | null; message: string };
  error: { code: string; message: string } | null;
  result: JobResult | null;
}

export interface JobInput { name: string; region: Region; rules: Rule[] }

/** Terminal states never change again; everything else should be polled. */
export const isActive = (s: JobState) => !["complete", "failed", "cancelled", "expired"].includes(s);

/** An error from the jobs service: `{"error": code, "message": text}`. */
export class JobsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const base = () => `${config().jobs ?? ""}/jobs`;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(`${base()}${path}`, init);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string };
    throw new JobsError(res.status, b.error ?? `http_${res.status}`, b.message ?? `HTTP ${res.status}`);
  }
  return body as T;
}

export const listJobs = () => call<{ jobs: Job[] }>("").then((r) => r.jobs);
export const getJob = (id: string) => call<Job>(`/${encodeURIComponent(id)}`);
/** Never retried here or by callers: a lost response may hide a queued job. Re-list instead. */
export const createJob = (input: JobInput) => call<Job>("", { method: "POST", body: JSON.stringify(input) });
export const cancelJob = (id: string) => call<Job>(`/${encodeURIComponent(id)}/cancel`, { method: "POST" });
export const getJobFeatures = (id: string) =>
  call<{ type: "FeatureCollection"; features: unknown[] }>(`/${encodeURIComponent(id)}/features`);

/** A user-facing message for a jobs error. */
export function describeJobError(e: unknown): string {
  if (!(e instanceof JobsError)) return e instanceof Error ? e.message : String(e);
  if (e.status === 429) return `Too many active jobs. Wait for one to finish or cancel it. ${e.message}`;
  if (e.status === 410) return "The results of this job have expired. Queue the search again.";
  if (e.status === 403) return "The jobs service did not accept your admin session.";
  return e.message;
}
