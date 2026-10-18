import { useState } from "react";
import { startSignIn } from "../auth";
import { config } from "../config";

/** Who adds organizers (Martijn, the operator). */
const OPERATOR = "martijn@osm.lol";

/**
 * Shown when the backend refuses both sign-ins: the account is neither a MapRoulette super-user
 * nor on the organizer list (organizer-admin.md §4.1).
 */
export function NotSetUp() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="center">
      <h1>You're not an organizer yet</h1>
      <p>Organizers are added by the Street Tally team for now. Tell us where you'd like to run a campaign, and we'll set you up.</p>
      <p>
        <a className="button-link" href={`mailto:${OPERATOR}?subject=Street%20Tally%20organizer`}>
          Ask to become an organizer
        </a>
      </p>
      <p className="hint">
        Server: <code data-testid="backend">{config().backend}</code>
      </p>
      {/* OpenStreetMap ignores prompt=login for this kind of sign-in and keeps you signed in, so
          signing in again would pick the same account: sign out there first. Its logout page only
          returns to its own site, hence a new tab. */}
      <p className="hint">Signed in with the wrong OpenStreetMap account? OpenStreetMap remembers it, so do this first:</p>
      <ol className="hint">
        <li>
          <a href={`${config().osmWeb}/logout`} target="_blank" rel="noopener noreferrer">
            Sign out of OpenStreetMap
          </a>{" "}
          (opens in a new tab; confirm there, then close the tab).
        </li>
        <li>Come back here and tap Sign in with another account.</li>
      </ol>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startSignIn();
        }}
      >
        Sign in with another account
      </button>
    </main>
  );
}
