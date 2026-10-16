export type Environment = "dev" | "stage" | "prod";

export interface Config {
  /** Backend origin, no trailing slash. */
  backend: string;
  clientId: string;
  /** Which deployment the backend is. Unknown when neither set nor recognisable from the host. */
  environment?: Environment;
  /** The OpenStreetMap site the backend signs in with, as an origin. */
  osmWeb: string;
  /** The participant site (live and review pages, campaign links) for this backend, as an origin. */
  participantSite: string;
}

const OSM = "https://www.openstreetmap.org";
const OSM_DEV = "https://master.apis.dev.openstreetmap.org";

const SITE: Record<Environment, string> = {
  dev: "https://streettally.mr-dev.osm.lol",
  stage: "https://streettally.mr-stage.osm.lol",
  prod: "https://streettally.osm.lol",
};

const ENVIRONMENTS: readonly string[] = ["dev", "stage", "prod"];

/** The environment of the known osm.lol backends and of a local backend. */
export function inferEnvironment(backend: string): Environment | undefined {
  let host: string;
  try {
    host = new URL(backend).hostname;
  } catch {
    return undefined;
  }
  if (/^mr-prod\./.test(host)) return "prod";
  if (/^mr-stage\./.test(host)) return "stage";
  if (/^mr-(api|dev)\./.test(host) || host === "localhost" || host === "127.0.0.1") return "dev";
  return undefined;
}

let current: Config | undefined;

/** Validates and sets the configuration. */
export function configure(raw: Partial<Config>): Config {
  if (!raw.backend || !raw.clientId) throw new Error("config.json needs backend and clientId");
  if (raw.environment !== undefined && !ENVIRONMENTS.includes(raw.environment))
    throw new Error("config.json environment must be dev, stage or prod");
  if (raw.osmWeb !== undefined && !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(raw.osmWeb))
    throw new Error("config.json osmWeb must be an origin like https://www.openstreetmap.org");
  if (raw.participantSite !== undefined && !/^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?$/.test(raw.participantSite))
    throw new Error("config.json participantSite must be an origin like https://streettally.osm.lol");
  const backend = raw.backend.replace(/\/+$/, "");
  const environment = raw.environment ?? inferEnvironment(backend);
  // Dev signs in with the OSM dev server; stage and prod with openstreetmap.org.
  const osmWeb = raw.osmWeb ?? (environment === "dev" ? OSM_DEV : OSM);
  // Each environment has its own participant site; an unknown backend links to prod's.
  const participantSite = raw.participantSite ?? SITE[environment ?? "prod"];
  current = { backend, clientId: raw.clientId, environment, osmWeb, participantSite };
  return current;
}

/** Loads /config.json (served next to the app, so each deployment sets its backend). */
export async function loadConfig(): Promise<Config> {
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  return configure((await res.json()) as Partial<Config>);
}

/** The participant site's origin; prod's until the configuration is loaded. */
export function participantSite(): string {
  return current?.participantSite ?? SITE.prod;
}

export function config(): Config {
  if (!current) throw new Error("config not loaded");
  return current;
}
