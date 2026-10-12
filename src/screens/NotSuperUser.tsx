import { useState } from "react";
import { startSignIn } from "../auth";
import { config } from "../config";

/** Shown when the backend answers the sign-in with access_denied: not a MapRoulette super-user. */
export function NotSuperUser() {
  const [busy, setBusy] = useState(false);
  return (
    <main className="center">
      <h1>Not a super-user</h1>
      <p>
        The OpenStreetMap account you signed in with is not a MapRoulette super-user on{" "}
        <code data-testid="backend">{config().backend}</code>. No session was created.
      </p>
      <p className="hint">
        Ask an administrator of that MapRoulette deployment to make your account a super-user, or sign
        in with another OpenStreetMap account.
      </p>
      {/* OpenStreetMap ignores prompt=login for this kind of sign-in and keeps you signed in, so
          signing in again would pick the same account: sign out there first. Its logout page only
          returns to its own site, hence a new tab. */}
      <p className="hint">
        OpenStreetMap remembers the account you used. To use another one, first{" "}
        <a href={`${config().osmWeb}/logout`} target="_blank" rel="noopener noreferrer">
          sign out of OpenStreetMap
        </a>{" "}
        in the tab that opens, then come back here.
      </p>
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
