import { useEffect, useState, useSyncExternalStore } from "react";
import { describeError, type Me, me } from "./api";
import { hasSession, onAuthChange, type Role, role, signOut } from "./auth";
import { navigate, usePath } from "./router";
import { Audit } from "./screens/Audit";
import { Callback } from "./screens/Callback";
import { CampaignList, CampaignPage } from "./screens/Campaigns";
import { Clients } from "./screens/Clients";
import { EnvironmentBadge, WritesPill } from "./screens/Environment";
import { Help } from "./screens/Help";
import { OrganizerRequestScreen } from "./screens/OrganizerRequest";
import { Organizers, useOpenRequestCount } from "./screens/Organizers";
import { SignIn } from "./screens/SignIn";
import { SurveyBuilder } from "./screens/SurveyBuilder";
import { Wizard } from "./screens/Wizard";
import { WritePolicy } from "./screens/WritePolicy";

interface Screen {
  title: string;
  render: () => React.ReactNode;
  /** Who may open it; in the nav for these roles unless `nav` says otherwise. */
  roles: Role[];
  nav?: Role[];
}

// Organizers see Campaigns and Help (organizer-admin.md §2), and start the wizard from Campaigns.
// The survey builder (/new/advanced) and stock Publish write through stock routes, which organizer
// grants can't, so they stay with super-users.
const SCREENS: Record<string, Screen> = {
  "/": { title: "Campaigns", render: () => <CampaignList />, roles: ["admin", "organizer"] },
  "/new": { title: "New campaign", render: () => <Wizard />, roles: ["admin", "organizer"], nav: ["admin"] },
  "/writes": { title: "Task writes", render: () => <WritePolicy />, roles: ["admin"] },
  "/clients": { title: "Clients", render: () => <Clients />, roles: ["admin"] },
  "/organizers": { title: "Organizers", render: () => <Organizers />, roles: ["admin"] },
  "/audit": { title: "Audit log", render: () => <Audit />, roles: ["admin"] },
  "/help": { title: "Help", render: () => <Help />, roles: ["organizer"] },
};

/** Old addresses, kept working: the survey builder and challenge import are New campaign's advanced path. */
const MOVED: Record<string, string> = { "/surveys": "/new/advanced", "/challenges": "/new/advanced" };

/** The screen for a path, and which nav entry it belongs to. */
function route(path: string, as: Role): { nav: string; node: React.ReactNode } | undefined {
  const m = /^\/campaigns\/([1-9][0-9]{0,15})$/.exec(path);
  if (m) return { nav: "/", node: <CampaignPage key={m[1]} id={Number(m[1])} /> };
  // The survey builder: the advanced path under New campaign.
  if (path === "/new/advanced") return as === "admin" ? { nav: "/new", node: <SurveyBuilder /> } : teamOnly;
  const screen = SCREENS[path];
  if (!screen) return undefined;
  if (screen.roles.includes(as)) return { nav: path, node: screen.render() };
  return teamOnly;
}

/** A bookmarked team page, opened by an organizer. */
const teamOnly = { nav: "", node: <p>This page is for the Street Tally team. Your campaigns are under Campaigns.</p> };

export function App() {
  const path = usePath();
  const signedIn = useSyncExternalStore(onAuthChange, hasSession);
  useEffect(() => {
    if (MOVED[path]) history.replaceState(null, "", MOVED[path]);
  }, [path]);

  if (path === "/callback") return <Callback />;
  if (!signedIn) return <SignIn />;

  const as = role();
  // Not an organizer yet: asking to become one is all this grant can do (ORG-ONB).
  if (as === "requester") return <OrganizerRequestScreen />;
  return <Signed as={as} path={path} />;
}

function Signed({ as, path }: { as: Role; path: string }) {
  const screen = route(MOVED[path] ?? path, as);
  const open = useOpenRequestCount(as === "admin");
  return (
    <>
      <header>
        <strong>Street Tally admin</strong>
        <nav>
          {Object.entries(SCREENS)
            .filter(([, s]) => (s.nav ?? s.roles).includes(as))
            .map(([to, s]) => (
              <a
                key={to}
                href={to}
                aria-current={to === screen?.nav ? "page" : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(to);
                }}
              >
                {to === "/organizers" && open ? `${s.title} (${open})` : s.title}
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
