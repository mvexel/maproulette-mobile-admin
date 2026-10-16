export interface ClaimConfig {
  /** Backend origin, no trailing slash. */
  backend: string;
  /** The claim page's public OAuth client (deferred-signup-api.md §3.7). */
  clientId: string;
  /** MapLibre style URL; empty shows the list without a map. */
  mapStyle: string;
  /** The OpenStreetMap website the backend edits, for "See your edits". */
  osmWeb: string;
  /** The review page's public OAuth client: `tasks:read` only, no OSM scope (handback-copy §2). */
  reviewClientId: string;
}

let current: ClaimConfig | undefined;

const origin = (v: string) => v.replace(/\/+$/, "");

/** Validates and sets the configuration. */
export function configure(raw: Partial<ClaimConfig>): ClaimConfig {
  if (!raw.backend || !raw.clientId) throw new Error("config.json needs backend and clientId");
  current = {
    backend: origin(raw.backend),
    clientId: raw.clientId,
    mapStyle: raw.mapStyle ?? "",
    osmWeb: origin(raw.osmWeb ?? "https://www.openstreetmap.org"),
    reviewClientId: raw.reviewClientId ?? "street-tally-review",
  };
  return current;
}

/** Loads config.json from next to the page, so each deployment sets its backend. */
export async function loadConfig(): Promise<ClaimConfig> {
  const res = await fetch(`${import.meta.env.BASE_URL}config.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  return configure((await res.json()) as Partial<ClaimConfig>);
}

export function config(): ClaimConfig {
  if (!current) throw new Error("config not loaded");
  return current;
}
