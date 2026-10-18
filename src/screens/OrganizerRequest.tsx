import { useEffect, useState } from "react";
import { askToOrganize, type MyOrganizerRequest, me, myOrganizerRequest } from "../api";
import { signOut, startSignIn } from "../auth";
import { navigate } from "../router";
import { ErrorMessage } from "./ErrorMessage";

/** Who looks at requests (Martijn, the operator). */
const OPERATOR = "martijn@osm.lol";
const MAILTO = `mailto:${OPERATOR}?subject=Street%20Tally%20organizer`;
/** OpenStreetMap's organised editing guidelines, which every organizer agrees to follow. */
export const GUIDELINES = "https://wiki.openstreetmap.org/wiki/Organised_Editing_Guidelines";

/**
 * ORG-ONB (organizer-onboarding.md §2.1, §2.2, §2.5): someone signed in with OpenStreetMap who
 * isn't an organizer yet asks to run campaigns. The request lives on the server; no email is sent.
 */
export function OrganizerRequestScreen() {
  const [mine, setMine] = useState<MyOrganizerRequest>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    myOrganizerRequest()
      .then(setMine)
      .catch((e: unknown) => setError(e));
  }, []);
  // An organizer's grant can't read the request, so the §2.4 note goes by what this browser saw.
  useEffect(() => {
    if (mine?.request?.state === "open") rememberAsked(mine.osmId);
  }, [mine]);

  if (!mine) return <main className="center ask">{error ? <ErrorMessage error={error} /> : <p>Loading…</p>}</main>;
  const { request } = mine;
  return (
    <main className="center ask">
      {mine.organizer ? (
        <SetUp />
      ) : mine.canRequest ? (
        <AskForm name={mine.name} onSent={(r) => setMine({ ...mine, canRequest: false, request: r })} />
      ) : request?.state === "open" ? (
        <>
          <h1>We've got your request</h1>
          <p>The Street Tally team looks at each request by hand. Sign in here again to see if you're set up.</p>
          <Questions />
        </>
      ) : request?.state === "declined" ? (
        <>
          <h1>We can't set you up right now.</h1>
          {request.note && <p className="decline-note">{request.note}</p>}
          {mine.askAgainAt && <p className="hint">You can ask again on {new Date(mine.askAgainAt).toLocaleDateString()}.</p>}
          <Questions />
        </>
      ) : (
        <>
          <h1>We aren't taking requests right now</h1>
          <Questions />
        </>
      )}
      <NotYou />
    </main>
  );
}

function AskForm({ name, onSent }: { name?: string; onSent: (r: NonNullable<MyOrganizerRequest["request"]>) => void }) {
  const [place, setPlace] = useState("");
  const [subject, setSubject] = useState("");
  const [group, setGroup] = useState("");
  const [policy, setPolicy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const ready = place.trim() !== "" && subject.trim() !== "" && policy && !busy;

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      onSent(await askToOrganize({ place: place.trim(), subject: subject.trim(), ...(group.trim() ? { group: group.trim() } : {}) }));
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Run a campaign with Street Tally</h1>
      <p>
        Tell us a little about your campaign, and the Street Tally team will set you up. You'll use this OpenStreetMap
        account, <strong data-testid="ask-username">{name ?? "…"}</strong>, to run it.
      </p>
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void send();
        }}
      >
        <label>
          Where will it happen?
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Woodbine, Toronto" maxLength={200} required />
        </label>
        <label>
          What will people check?
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Entrances and crossings" maxLength={200} required />
        </label>
        <label>
          <span>
            Your group or organization <span className="hint">(optional)</span>
          </span>
          <input value={group} onChange={(e) => setGroup(e.target.value)} maxLength={200} />
        </label>
        <label className="inline">
          <input type="checkbox" checked={policy} onChange={(e) => setPolicy(e.target.checked)} />
          <span>
            I'll follow OpenStreetMap's{" "}
            <a href={GUIDELINES} target="_blank" rel="noopener noreferrer">
              organised editing guidelines
            </a>
          </span>
        </label>
        <ErrorMessage error={error} />
        <button type="submit" disabled={!ready}>
          Ask to run campaigns
        </button>
      </form>
    </>
  );
}

/** Approved while this grant was signed in: the organizer grant needs a new sign-in. */
function SetUp() {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <h1>You're set up</h1>
      <p>Sign in again to start your first campaign.</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void signOut().then(() => startSignIn());
        }}
      >
        Sign in again
      </button>
    </>
  );
}

function Questions() {
  return (
    <p>
      <a href={MAILTO}>Questions? Email {OPERATOR}</a>
    </p>
  );
}

function NotYou() {
  return (
    <p className="hint">
      Not you?{" "}
      <button type="button" className="link" onClick={() => void signOut()}>
        Sign out
      </button>
    </p>
  );
}

/** The OSM id of whoever last had an open request in this browser. */
const ASKED_KEY = "mrma.askedToOrganize";

function rememberAsked(osmId: number) {
  try {
    localStorage.setItem(ASKED_KEY, String(osmId));
  } catch {
    // No storage: no note after the approval.
  }
}

/**
 * §2.4: the one-time note on Campaigns after an approval. An organizer's grant can't read the
 * request (backend: mobile:organizer-request only), so it shows when this browser last saw this
 * person's open request, once. Another browser shows nothing.
 */
export function SetUpNote() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let current = true;
    let asked: string | null = null;
    try {
      asked = localStorage.getItem(ASKED_KEY);
    } catch {
      return;
    }
    if (!asked) return;
    me()
      .then((u) => {
        if (!current || String(u.osmId) !== asked) return;
        try {
          localStorage.removeItem(ASKED_KEY);
        } catch {
          // It may show again next time.
        }
        setShow(true);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  if (!show) return null;
  return (
    <div className="notice set-up-note" role="status">
      <p className="set-up-text">You're set up. Start your first campaign.</p>
      <button type="button" onClick={() => navigate("/new")}>
        New campaign
      </button>
    </div>
  );
}
