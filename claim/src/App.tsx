import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type ClaimStatus,
  claimStatus,
  deleteData,
  me,
  type Preview,
  preview,
  startClaim,
  stopReminders,
} from "./api";
import { config } from "./config";
import { route, tokenFrom } from "./link";
import {
  accessToken,
  completeSignIn,
  rememberClaim,
  rememberedClaim,
  rememberedToken,
  rememberToken,
  SignInError,
  signedIn,
  signOut,
  startSignIn,
} from "./session";
import { StopMap } from "./StopMap";
import { count, found, shortDate } from "./words";

/** Every screen of the claim page (deferred-signup-ux.md §3 and §4). */
type View =
  | { k: "loading" }
  | { k: "answers"; p: Preview; notNow?: boolean }
  | { k: "paused"; p: Preview }
  | { k: "signin-failed" }
  | { k: "confirm"; p: Preview; user: string }
  | { k: "working"; user: string; s?: ClaimStatus }
  | { k: "result"; user: string; s: ClaimStatus }
  | { k: "waiting" }
  | { k: "reauth"; s?: ClaimStatus }
  | { k: "other-user"; name: string }
  | { k: "finished" }
  | { k: "expired"; p: Preview }
  | { k: "deleted" }
  | { k: "unknown" }
  | { k: "error"; retry: () => void }
  | { k: "delete"; p: Preview }
  | { k: "deleted-now" }
  | { k: "stop"; p: Preview }
  | { k: "stopped"; p: Preview };

const CAMPAIGN = "claim.campaign";
const LABELS = "claim.labels";
const POLL_MS = 2000;

function keepCampaign(p: Preview) {
  const c = p.challenges[0];
  if (c) sessionStorage.setItem(CAMPAIGN, JSON.stringify({ name: c.name, hashtag: p.hashtag, wikiUrl: p.wikiUrl }));
  if (p.tasks.length)
    sessionStorage.setItem(LABELS, JSON.stringify(Object.fromEntries(p.tasks.map((t) => [t.taskId, t.label ?? ""]))));
}
const campaign = (): { name?: string; hashtag?: string; wikiUrl?: string } =>
  JSON.parse(sessionStorage.getItem(CAMPAIGN) ?? "{}");
const labelOf = (taskId: number): string =>
  (JSON.parse(sessionStorage.getItem(LABELS) ?? "{}") as Record<string, string>)[taskId] || `Place ${taskId}`;

/** The view for a preview's token state, on the main claim link. */
function fromPreview(p: Preview): View {
  if (p.state === "claimed") return { k: "finished" };
  if (p.state === "expired") return { k: "expired", p };
  if (p.state === "deleted") return { k: "deleted" };
  return p.writesEnabled ? { k: "answers", p } : { k: "paused", p };
}

export function App() {
  const [view, setView] = useState<View>({ k: "loading" });
  const [token, setToken] = useState<string>();
  const poll = useRef<number | undefined>(undefined);

  const fail = useCallback((e: unknown, retry: () => void) => {
    if (e instanceof ApiError && e.status === 404) return setView({ k: "unknown" });
    setView({ k: "error", retry });
  }, []);

  const follow = useCallback((claimId: number, user: string) => {
    window.clearTimeout(poll.current);
    const tick = async () => {
      try {
        const s = await claimStatus(claimId, await accessToken());
        if (s.state === "done" || s.state === "failed") {
          setView({ k: "result", user, s });
          await signOut(); // §3.7: the page revokes its own grant once the claim is finished
          return;
        }
        if (s.state === "waiting") return setView({ k: "waiting" });
        setView({ k: "working", user, s });
        poll.current = window.setTimeout(tick, POLL_MS);
      } catch (e) {
        if (e instanceof SignInError) return setView({ k: "finished" });
        poll.current = window.setTimeout(tick, POLL_MS * 2);
      }
    };
    setView({ k: "working", user });
    void tick();
  }, []);

  const load = useCallback(
    async (t: string, as: "claim" | "delete" | "stop-reminders") => {
      setView({ k: "loading" });
      try {
        const p = await preview(t);
        keepCampaign(p);
        if (as === "claim") return setView(fromPreview(p));
        if (p.state !== "active") return setView(fromPreview(p));
        setView(as === "delete" ? { k: "delete", p } : { k: "stop", p });
      } catch (e) {
        fail(e, () => void load(t, as));
      }
    },
    [fail],
  );

  const afterSignIn = useCallback(
    async (t: string) => {
      try {
        const [user, p] = await Promise.all([me(await accessToken()), preview(t)]);
        keepCampaign(p);
        if (p.state !== "active") return setView(fromPreview(p));
        setView({ k: "confirm", p, user: user.displayName });
      } catch (e) {
        if (e instanceof SignInError) return setView({ k: "signin-failed" });
        fail(e, () => void afterSignIn(t));
      }
    },
    [fail],
  );

  useEffect(() => {
    const r = route(location.pathname);
    if (r === "callback") {
      const t = rememberedToken();
      const params = new URLSearchParams(location.search);
      // Keep the code out of the address bar and history; the token stays in sessionStorage.
      history.replaceState(null, "", "/claim");
      if (!t) return setView({ k: "unknown" });
      setToken(t);
      completeSignIn(params).then(
        () => afterSignIn(t),
        () => setView({ k: "signin-failed" }),
      );
      return;
    }
    const t = tokenFrom(location.hash) ?? (r === "claim" ? rememberedToken() : undefined);
    if (!t || r === "unknown") return setView({ k: "unknown" });
    rememberToken(t);
    setToken(t);
    const c = rememberedClaim();
    if (r === "claim" && c && signedIn()) return follow(c.claimId, c.displayName);
    void load(t, r === "claim" ? "claim" : r);
    return () => window.clearTimeout(poll.current);
  }, [afterSignIn, follow, load]);

  const putOnMap = async (user: string) => {
    if (!token) return;
    setView({ k: "working", user });
    try {
      const started = await startClaim(token, await accessToken());
      rememberClaim({ claimId: started.claimId, displayName: started.user.displayName });
      if (started.state === "waiting") return setView({ k: "waiting" });
      follow(started.claimId, started.user.displayName);
    } catch (e) {
      if (e instanceof SignInError) return setView({ k: "signin-failed" });
      if (e instanceof ApiError) {
        if (e.code === "osm_reauth_required" || e.code === "invalid_token") return setView({ k: "reauth" });
        if (e.code === "mobile_writes_disabled") return setView({ k: "waiting" });
        if (e.code === "guest_claimed") {
          const as = (e.body.claimedAs as { displayName?: string } | undefined)?.displayName;
          return setView({ k: "other-user", name: as ?? "another account" });
        }
      }
      fail(e, () => void putOnMap(user));
    }
  };

  const switchAccount = async () => {
    await signOut();
    await startSignIn();
  };

  return (
    <Page token={token} view={view}>
      <Screen view={view} onSignIn={startSignIn} onConfirm={putOnMap} onSwitch={switchAccount} token={token} onDone={setView} />
    </Page>
  );
}

function Page({ token, view, children }: { token?: string; view: View; children: ReactNode }) {
  const c = campaign();
  const canDelete = token && ["answers", "paused", "confirm", "stop", "stopped"].includes(view.k);
  return (
    <>
      <header>
        <div className="in">
          <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={40} height={40} />
          <div>
            <div className="campaign">{c.name ?? "Street Tally"}</div>
            {c.name && <div className="on">on Street Tally</div>}
          </div>
        </div>
      </header>
      <main aria-live="polite">{children}</main>
      <footer>
        {canDelete && <a href={`/claim/delete#t=${token}`}>Delete my data</a>}
        <a href="/privacy">Privacy</a>
        {c.hashtag &&
          (c.wikiUrl ? (
            <a href={c.wikiUrl} rel="noreferrer">
              {c.hashtag} · About this campaign
            </a>
          ) : (
            <span>{c.hashtag}</span>
          ))}
      </footer>
    </>
  );
}

const Card = ({ children }: { children: ReactNode }) => <div className="card">{children}</div>;

function Screen({
  view,
  token,
  onSignIn,
  onConfirm,
  onSwitch,
  onDone,
}: {
  view: View;
  token?: string;
  onSignIn: () => Promise<void>;
  onConfirm: (user: string) => Promise<void>;
  onSwitch: () => Promise<void>;
  onDone: (v: View) => void;
}) {
  const [busy, setBusy] = useState(false);
  const run = (f: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await f();
    } finally {
      setBusy(false);
    }
  };
  const edits = (user: string) => `${config().osmWeb}/user/${encodeURIComponent(user)}/history`;

  switch (view.k) {
    case "loading":
      return <p className="muted">Loading…</p>;

    case "answers":
    case "paused": {
      const p = view.p;
      const what = found(p);
      return (
        <Card>
          <h1>You checked {count(p.pending, p)}</h1>
          <StopMap tasks={p.tasks} />
          <StopList p={p} />
          <div className="facts">
            <div className="fact">
              <b>What you found:</b> {what ?? `Your ${p.noun?.many ?? "places"} are in good shape.`}
            </div>
            {p.tally && (
              <div className="fact">
                <b>The tally:</b> {p.tally.checked} of {count(p.tally.total, p)} checked in {p.challenges[0]?.name}.
              </div>
            )}
          </div>
          <h2>Put them on the map</h2>
          {view.k === "answers" ? (
            <>
              <p className="muted">
                Your answers will be added to OpenStreetMap under your own account, so riders, apps and the city can use them.
              </p>
              {view.notNow && <p className="note">No problem. Your answers stay saved until {shortDate(p.expiresAt)}.</p>}
              <button type="button" className="btn primary" disabled={busy} onClick={run(onSignIn)}>
                Sign in to OpenStreetMap
              </button>
              <p className="muted small">No account? You can create one on the next screen with Google, Apple or email.</p>
            </>
          ) : (
            <p className="note">
              We can't put answers on the map right this minute. Please come back later; this link works until{" "}
              {shortDate(p.expiresAt)}.
            </p>
          )}
          <p className="small">
            <b>Saved until {shortDate(p.expiresAt)}.</b>
          </p>
        </Card>
      );
    }

    case "signin-failed":
      return (
        <Card>
          <h1>Sign-in didn't finish</h1>
          <button type="button" className="btn primary" disabled={busy} onClick={run(onSignIn)}>
            Try again
          </button>
          <p className="muted">Creating an account? Check your email for OpenStreetMap's confirmation, then come back to this page.</p>
        </Card>
      );

    case "confirm":
      return (
        <Card>
          <h1>Ready to put {count(view.p.pending, view.p)} on the map?</h1>
          <p>
            Signed in as <b>{view.user}</b> ·{" "}
            <button type="button" className="link" onClick={run(onSwitch)}>
              Not you? Switch account
            </button>
          </p>
          <p className="muted">
            Your answers will be added to OpenStreetMap under your name, one edit per stop
            {view.p.hashtag ? `, tagged ${view.p.hashtag}` : ""}. Edits on OpenStreetMap are public.
          </p>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={run(() => onConfirm(view.user))}>
              Put them on the map
            </button>
            <button type="button" className="btn secondary" onClick={() => onDone({ k: "answers", p: view.p, notNow: true })}>
              Not now
            </button>
          </div>
        </Card>
      );

    case "working": {
      const s = view.s;
      const done = s ? s.items.length : 0;
      const total = s?.total ?? 0;
      return (
        <Card>
          <h1>Putting your answers on the map…</h1>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
            <div style={{ width: total ? `${Math.round((done / total) * 100)}%` : "8%" }} />
          </div>
          <p className="muted">
            {total ? `${done} of ${total}. ` : ""}You can close this page; reopening the link shows where it got to.
          </p>
        </Card>
      );
    }

    case "result":
      return <Result s={view.s} user={view.user} edits={edits(view.user)} />;

    case "waiting":
      return (
        <Card>
          <h1>Your answers are safe</h1>
          <p>We can't put them on the map right this minute. They'll go on automatically, and we'll email you when they're there.</p>
          <p className="note">Nothing else to do. You can close this page.</p>
        </Card>
      );

    case "reauth":
      return (
        <Card>
          <h1>
            {view.s ? `${view.s.published} of ${view.s.total} are on the map.` : "Sign in again to finish"}
          </h1>
          <p>
            OpenStreetMap needs you to sign in again to add {view.s ? "the rest" : "your answers"}. Your answers are safe, and
            nothing will be added twice.
          </p>
          <button type="button" className="btn primary" disabled={busy} onClick={run(onSwitch)}>
            Sign in to OpenStreetMap
          </button>
        </Card>
      );

    case "other-user":
      return (
        <Card>
          <h1>These answers are already taken care of</h1>
          <p>They were put on the map by {view.name}. If that's you, sign in as {view.name}.</p>
          <button type="button" className="btn secondary" disabled={busy} onClick={run(onSwitch)}>
            Switch account
          </button>
        </Card>
      );

    case "finished":
      return (
        <Card>
          <h1>
            <span className="ok">✓</span> These answers are already on the map
          </h1>
          <p className="muted">There's nothing left to do here.</p>
        </Card>
      );

    case "expired":
      return (
        <Card>
          <h1>This link expired on {shortDate(view.p.expiresAt)}</h1>
          <p>The answers were removed. They still count in the campaign's totals.</p>
          <p className="muted">Thanks for checking.</p>
        </Card>
      );

    case "deleted":
      return (
        <Card>
          <h1>These answers were deleted at your request</h1>
        </Card>
      );

    case "unknown":
      return (
        <Card>
          <h1>We can't find this link</h1>
          <p className="muted">Check you copied the whole address from the email.</p>
        </Card>
      );

    case "error":
      return (
        <Card>
          <h1>Couldn't reach the server</h1>
          <p className="muted">Check your connection and try again. Nothing was added twice.</p>
          <button type="button" className="btn primary" onClick={view.retry}>
            Try again
          </button>
        </Card>
      );

    case "delete":
      return (
        <Card>
          <h1>Delete my data</h1>
          <p>
            This removes your email address and the {count(view.p.pending, view.p)} that aren't on the map yet. Answers already on
            OpenStreetMap stay there, because they belong to OpenStreetMap now.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn danger"
              disabled={busy || !token}
              onClick={run(async () => {
                await deleteData(token!);
                onDone({ k: "deleted-now" });
              })}
            >
              Delete my data
            </button>
            <a className="btn secondary" href={`/claim#t=${token}`}>
              Keep my answers
            </a>
          </div>
        </Card>
      );

    case "deleted-now":
      return (
        <Card>
          <h1>Done.</h1>
          <p>We've deleted your email address and saved answers.</p>
        </Card>
      );

    case "stop":
      return (
        <Card>
          <h1>Stop reminder emails?</h1>
          <p>
            We won't email you about these answers again. They stay saved until {shortDate(view.p.expiresAt)}, and the link in
            your email still works.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn primary"
              disabled={busy || !token}
              onClick={run(async () => {
                await stopReminders(token!);
                onDone({ k: "stopped", p: view.p });
              })}
            >
              Stop reminders
            </button>
            <a className="btn secondary" href={`/claim#t=${token}`}>
              Keep reminders
            </a>
          </div>
        </Card>
      );

    case "stopped":
      return (
        <Card>
          <h1>Done.</h1>
          <p>No more reminders. Your answers are saved until {shortDate(view.p.expiresAt)}.</p>
        </Card>
      );
  }
}

function StopList({ p }: { p: Preview }) {
  if (!p.tasks.length) return null;
  return (
    <details className="stops">
      <summary>Show the list</summary>
      <ul>
        {p.tasks.map((t) => (
          <li key={t.taskId}>
            <b>{t.label ?? `Place ${t.taskId}`}</b>
            {t.answers?.length ? `: ${t.answers.map((a) => `${a.prompt} ${a.label}`).join(" · ")}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

const REASON: Record<string, string> = {
  superseded: "Someone else checked it first",
  skipped_stale: "It changed on the map since you were there",
  failed: "Something went wrong",
};

function Result({ s, user, edits }: { s: ClaimStatus; user: string; edits: string }) {
  const notAdded = s.items.filter((i) => i.state !== "published");
  const partly = s.items.filter((i) => i.state === "published" && i.dropped.length);
  const failed = s.items.filter((i) => i.state === "failed").length;
  const seeEdits = (
    <a href={edits} rel="noreferrer">
      See your edits on OpenStreetMap
    </a>
  );
  if (s.state === "failed" || failed) {
    return (
      <Card>
        <h1>
          {s.published} of {s.total} are on the map
        </h1>
        <p>Something went wrong with the rest. We'll keep trying, and you won't add anything twice.</p>
        <p>{seeEdits}</p>
      </Card>
    );
  }
  return (
    <Card>
      <h1>
        <span className="ok">✓</span> {s.published} {s.published === 1 ? "place is" : "places are"} on the map
      </h1>
      {notAdded.length > 0 && (
        <p>
          <b>
            {notAdded.length} {notAdded.length === 1 ? "place wasn't" : "places weren't"} added
          </b>
          , because someone updated {notAdded.length === 1 ? "it" : "them"} after you checked. Nothing to do;{" "}
          {notAdded.length === 1 ? "it's" : "they're"} up to date.
        </p>
      )}
      {(notAdded.length > 0 || partly.length > 0) && (
        <details>
          <summary>Show which</summary>
          <ul className="list">
            {notAdded.map((i) => (
              <li key={i.taskId}>
                <b>{labelOf(i.taskId)}</b>: {REASON[i.state]}.
              </li>
            ))}
            {partly.map((i) => (
              <li key={i.taskId}>
                {i.dropped.length === 1 ? "One answer" : `${i.dropped.length} answers`} for <b>{labelOf(i.taskId)}</b>{" "}
                {i.dropped.length === 1 ? "wasn't" : "weren't"} added because the map already had it. The rest were.
              </li>
            ))}
          </ul>
        </details>
      )}
      <p>
        Thank you, {user}. {seeEdits}
      </p>
      <p className="muted">Your phone will sign in as you the next time you open Street Tally.</p>
    </Card>
  );
}
