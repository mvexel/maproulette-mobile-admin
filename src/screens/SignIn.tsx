import { useState } from "react";
import { startSignIn } from "../auth";
import { config } from "../config";

export function SignIn({ error }: { error?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="center">
      <h1>MapRoulette mobile admin</h1>
      <p>
        Backend: <code data-testid="backend">{config().backend}</code>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void startSignIn();
        }}
      >
        Sign in with OpenStreetMap
      </button>
      <p className="hint">Only MapRoulette super-users can sign in.</p>
    </main>
  );
}
