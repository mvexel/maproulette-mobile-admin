import { useEffect, useState, useSyncExternalStore } from "react";
import { describeError, me, type Me } from "./api";
import { hasSession, onAuthChange, signOut } from "./auth";
import { navigate, usePath } from "./router";
import { Audit } from "./screens/Audit";
import { Callback } from "./screens/Callback";
import { Clients } from "./screens/Clients";
import { CampaignList, CampaignPage } from "./screens/Campaigns";
import { EnvironmentBadge, WritesPill } from "./screens/Environment";
import { SignIn } from "./screens/SignIn";
import { WritePolicy } from "./screens/WritePolicy";
import { SurveyBuilder } from "./screens/SurveyBuilder";

const SCREENS: Record<string, { title: string; render: () => React.ReactNode }> = {
  "/": { title: "Campaigns", render: () => <CampaignList /> },
  "/new": { title: "New campaign", render: () => <SurveyBuilder /> },
  "/writes": { title: "Task writes", render: () => <WritePolicy /> },
  "/clients": { title: "Clients", render: () => <Clients /> },
  "/audit": { title: "Audit log", render: () => <Audit /> },
};

/** Old addresses, kept working: the survey builder and challenge import now live in New campaign. */
const MOVED: Record<string, string> = { "/surveys": "/new", "/challenges": "/new" };

/** The screen for a path, and which nav entry it belongs to. */
function route(path: string): { nav: string; node: React.ReactNode } | undefined {
  const m = /^\/campaigns\/([1-9][0-9]{0,15})$/.exec(path);
  if (m) return { nav: "/", node: <CampaignPage key={m[1]} id={Number(m[1])} /> };
  const screen = SCREENS[path];
  return screen && { nav: path, node: screen.render() };
}

export function App() {
  const path = usePath();
  const signedIn = useSyncExternalStore(onAuthChange, hasSession);
  useEffect(() => {
    if (MOVED[path]) history.replaceState(null, "", MOVED[path]);
  }, [path]);

  if (path === "/callback") return <Callback />;
  if (!signedIn) return <SignIn />;

  const screen = route(MOVED[path] ?? path);
  return (
    <>
      <header>
        <strong>MapRoulette mobile admin</strong>
        <nav>
          {Object.entries(SCREENS).map(([to, s]) => (
            <a
              key={to}
              href={to}
              aria-current={to === screen?.nav ? "page" : undefined}
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
      <main>{screen ? screen.node : <p>Page not found.</p>}</main>
    </>
  );
}

/** Who is signed in, against which backend, and whether task writes are on. */
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
      <EnvironmentBadge />
      <WritesPill />
      {user && <span data-testid="user">{user.displayName}</span>}
      {error && <span className="error">{error}</span>}
    </span>
  );
}
