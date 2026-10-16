import { useState } from "react";
import { startSignIn } from "../auth";
import { config } from "../config";

/**
 * Shown when the backend refuses both grants: the account is neither a super-user nor on the
 * organizer list (design/organizer-admin.md §4.1).
 */
export function NotSetUp() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="center">
      <h1>Not set up yet</h1>
      <p>Your account isn't set up to run campaigns yet.</p>
      <p>
        <a href="mailto:martijn@osm.lol?subject=Run%20campaigns%20on%20Street%20Tally">Ask us to add you</a>, and tell us
        your OpenStreetMap username and the group you organize for.
      </p>
      <p className="hint">
        Server: <code data-testid="backend">{config().backend}</code>. You're not signed in.
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
