export type Environment = "dev" | "stage" | "prod";

export interface Config {
  /** Backend origin, no trailing slash. */
  backend: string;
  clientId: string;
  /** Which deployment the backend is. Unknown when neither set nor recognisable from the host. */
  environment?: Environment;
}

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
  const backend = raw.backend.replace(/\/+$/, "");
  current = { backend, clientId: raw.clientId, environment: raw.environment ?? inferEnvironment(backend) };
  return current;
}

/** Loads /config.json (served next to the app, so each deployment sets its backend). */
export async function loadConfig(): Promise<Config> {
  const res = await fetch("/config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`);
  return configure((await res.json()) as Partial<Config>);
}

export function config(): Config {
  if (!current) throw new Error("config not loaded");
  return current;
}
