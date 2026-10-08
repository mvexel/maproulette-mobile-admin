export interface Config {
  /** Backend origin, no trailing slash. */
  backend: string;
  clientId: string;
  /** Origin of the jobs service. Omitted in deployments: it is then same-origin (/jobs). */
  jobs?: string;
  /** Job polling interval in ms (default 2000); tests lower it. */
  jobsPollMs?: number;
}

let current: Config | undefined;

/** Validates and sets the configuration. */
export function configure(raw: Partial<Config>): Config {
  if (!raw.backend || !raw.clientId) throw new Error("config.json needs backend and clientId");
  current = {
    backend: raw.backend.replace(/\/+$/, ""),
    clientId: raw.clientId,
    ...(raw.jobs ? { jobs: raw.jobs.replace(/\/+$/, "") } : {}),
    ...(raw.jobsPollMs ? { jobsPollMs: raw.jobsPollMs } : {}),
  };
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
