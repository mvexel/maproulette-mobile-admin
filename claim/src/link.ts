/**
 * The emailed links carry the claim token in the URL fragment (deferred-signup-api.md §2, §3.10):
 * /claim#t=<token>, /claim/delete#t=<token>, /claim/stop-reminders#t=<token>. The fragment never
 * reaches a server log; the page POSTs the token to the API.
 */
export type Route = "claim" | "callback" | "delete" | "stop-reminders" | "unknown";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function route(pathname: string): Route {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/claim") return "claim";
  if (p === "/claim/callback") return "callback";
  if (p === "/claim/delete") return "delete";
  if (p === "/claim/stop-reminders") return "stop-reminders";
  return "unknown";
}

/** The claim token from a fragment like "#t=…", or undefined if missing or malformed. */
export function tokenFrom(hash: string): string | undefined {
  const t = new URLSearchParams(hash.replace(/^#/, "")).get("t") ?? "";
  return TOKEN.test(t) ? t : undefined;
}
