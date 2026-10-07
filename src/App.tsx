import { useEffect, useState, useSyncExternalStore } from "react";
import { describeError, me, type Me } from "./api";
import { hasSession, onAuthChange, signOut } from "./auth";
import { config } from "./config";
import { navigate, usePath } from "./router";
import { Audit } from "./screens/Audit";
import { Callback } from "./screens/Callback";
import { Clients } from "./screens/Clients";
import { SignIn } from "./screens/SignIn";
import { WritePolicy } from "./screens/WritePolicy";

const SCREENS: Record<string, { title: string; render: () => React.ReactNode }> = {
  "/": { title: "Clients", render: () => <Clients /> },
  "/audit": { title: "Audit log", render: () => <Audit /> },
  "/writes": { title: "Task writes", render: () => <WritePolicy /> },
};

export function App() {
  const path = usePath();
  const signedIn = useSyncExternalStore(onAuthChange, hasSession);

  if (path === "/callback") return <Callback />;
  if (!signedIn) return <SignIn />;

  const screen = SCREENS[path];
  return (
    <>
      <header>
        <strong>MapRoulette mobile admin</strong>
        <nav>
          {Object.entries(SCREENS).map(([to, s]) => (
            <a
              key={to}
              href={to}
              aria-current={to === path ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(to);
              }}
            >
              {s.title}
            </a>
          ))}
        </nav>
        <Identity />
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <main>{screen ? screen.render() : <p>Page not found.</p>}</main>
    </>
  );
}

/** Who is signed in, and against which backend. */
function Identity() {
  const [user, setUser] = useState<Me>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    me()
      .then(setUser)
      .catch((e: unknown) => setError(describeError(e).message));
  }, []);
  return (
    <span className="identity">
      <span data-testid="backend" title="Connected backend">
        {config().backend}
      </span>
      {user && <span data-testid="user">{user.displayName}</span>}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
