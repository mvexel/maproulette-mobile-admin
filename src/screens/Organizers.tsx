import { useCallback, useEffect, useState } from "react";
import {
  addOrganizer,
  approveOrganizerRequest,
  declineOrganizerRequest,
  listOrganizerRequests,
  listOrganizers,
  type OpenOrganizerRequest,
  type Organizer,
  type OrganizerRole,
  removeOrganizer,
  removeOrganizerProject,
} from "../api";
import { config } from "../config";
import { ErrorMessage } from "./ErrorMessage";
import { useProjects } from "./Projects";

// The nav's "Organizers (N)": the open request count, re-read after an Approve or Decline here.
const countListeners = new Set<() => void>();
const requestsChanged = () => {
  for (const l of countListeners) l();
};

/** Open organizer requests, for super-users; 0 when there are none or the list can't be read. */
export function useOpenRequestCount(enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const read = () =>
      void listOrganizerRequests()
        .then((r) => current && setCount(r.length))
        .catch(() => current && setCount(0));
    read();
    countListeners.add(read);
    return () => {
      current = false;
      countListeners.delete(read);
    };
  }, [enabled]);
  return enabled ? count : 0;
}

/**
 * Super-users only: who may run campaigns (D8, organizer-admin.md §4.1). Adding someone gives them
 * a role on a project and puts them on the organizer list; they then sign in to this app and see
 * that project's campaigns only.
 */
export function Organizers() {
  const [organizers, setOrganizers] = useState<Organizer[]>();
  const [requests, setRequests] = useState<OpenOrganizerRequest[]>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(() => {
    listOrganizers()
      .then(setOrganizers)
      .catch((e: unknown) => setError(e));
    // Requests come with the backend's ORG-ONB routes; without them the section stays away.
    listOrganizerRequests()
      .then(setRequests)
      .catch(() => setRequests(undefined));
    requestsChanged();
  }, []);
  useEffect(reload, [reload]);

  /** Runs one change; false when it failed (the error shows above the list). */
  const act = async (work: () => Promise<string>) => {
    setError(undefined);
    setNotice(undefined);
    try {
      setNotice(await work());
      reload();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };

  return (
    <section>
      {requests && requests.length > 0 && (
        <Requests
          requests={requests}
          onApprove={(r, projectName) =>
            act(async () => {
              await approveOrganizerRequest(r.id, projectName);
              return `${r.name} can now run campaigns in ${projectName}.`;
            })
          }
          onDecline={(r, note) =>
            act(async () => {
              await declineOrganizerRequest(r.id, note);
              return `Declined ${r.name}'s request.`;
            })
          }
        />
      )}
      <h2>Organizers</h2>
      <p className="hint">
        Organizers run the campaigns of their projects in this app: create, publish, share and export them. They
        don't see apps, the audit log or this list, and can't turn saving answers on or off.
      </p>
      <AddOrganizer onAdded={(o) => void act(async () => `Added ${o.name}.`)} onError={setError} />
      <ErrorMessage error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!organizers ? (
        !error && <p>Loading…</p>
      ) : organizers.length === 0 ? (
        <p>No organizers yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>OpenStreetMap user</th>
              <th>Projects</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {organizers.map((o) => (
              <tr key={o.userId} data-testid={`organizer-${o.userId}`}>
                <td>{o.name}</td>
                <td>
                  {o.projects.length === 0 && <span className="hint">No projects</span>}
                  {o.projects.map((p) => (
                    <div key={p.id}>
                      {p.displayName || p.name} <span className="hint">({p.role})</span>{" "}
                      <button
                        type="button"
                        className="link"
                        onClick={() =>
                          void act(async () => {
                            await removeOrganizerProject(o.userId, p.id);
                            return `Removed ${o.name} from ${p.displayName || p.name}.`;
                          })
                        }
                      >
                        Remove from project
                      </button>
                    </div>
                  ))}
                </td>
                <td>{new Date(o.createdAt).toLocaleDateString()}</td>
                <td>
                  <button
                    type="button"
                    onClick={() =>
                      void act(async () => {
                        await removeOrganizer(o.userId);
                        return `${o.name} can no longer run campaigns. Their project roles stay.`;
                      })
                    }
                  >
                    Remove organizer
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddOrganizer({ onAdded, onError }: { onAdded: (o: Organizer) => void; onError: (e: unknown) => void }) {
  const { projects } = useProjects();
  const [username, setUsername] = useState("");
  const [projectId, setProjectId] = useState<number>();
  const [role, setRole] = useState<OrganizerRole>("write");
  const [busy, setBusy] = useState(false);
  const ready = username.trim() !== "" && projectId !== undefined && !busy;

  async function add() {
    if (projectId === undefined) return;
    setBusy(true);
    onError(undefined);
    try {
      onAdded(await addOrganizer(username.trim(), projectId, role));
      setUsername("");
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="organizer-form"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label>
        OpenStreetMap username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Project
        <select
          value={projectId ?? ""}
          disabled={!projects}
          onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">{projects ? "Pick a project" : "Loading projects…"}</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName || p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as OrganizerRole)}>
          <option value="write">Write: runs the project's campaigns</option>
          <option value="admin">Admin: also manages the project on MapRoulette</option>
        </select>
      </label>
      <button type="submit" disabled={!ready}>
        Add organizer
      </button>
      <p className="hint">They need to have signed in to MapRoulette once with that account.</p>
    </form>
  );
}

const osmProfile = (name: string) => `${config().osmWeb}/user/${encodeURIComponent(name)}`;

/** "3 weeks old", from the OSM account snapshot taken when they asked. */
function accountAge(createdAt: string): string {
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(createdAt)) / 86_400_000));
  if (days < 1) return "new today";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} old`;
  if (days < 61) return `${Math.floor(days / 7)} weeks old`;
  if (days < 730) return `${Math.floor(days / 30.4)} months old`;
  return `${Math.floor(days / 365.25)} years old`;
}

/** ORG-ONB (organizer-onboarding.md §2.3): open requests, on top of the list. */
function Requests({
  requests,
  onApprove,
  onDecline,
}: {
  requests: OpenOrganizerRequest[];
  onApprove: (r: OpenOrganizerRequest, projectName: string) => Promise<boolean>;
  onDecline: (r: OpenOrganizerRequest, note: string) => Promise<boolean>;
}) {
  return (
    <section className="requests" aria-labelledby="requests-heading">
      <h2 id="requests-heading">Requests</h2>
      <p className="hint">
        People who asked to run campaigns. Approve makes a project for their place, gives them Write on it and adds them
        to the list below.
      </p>
      <ul className="request-list">
        {requests.map((r) => (
          <RequestRow key={r.id} r={r} onApprove={onApprove} onDecline={onDecline} />
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  r,
  onApprove,
  onDecline,
}: {
  r: OpenOrganizerRequest;
  onApprove: (r: OpenOrganizerRequest, projectName: string) => Promise<boolean>;
  onDecline: (r: OpenOrganizerRequest, note: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState<"approve" | "decline">();
  const [projectName, setProjectName] = useState(r.place);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<boolean>) => {
    setBusy(true);
    if (!(await work())) setBusy(false);
  };
  return (
    <li className="request" data-testid={`request-${r.id}`}>
      <div className="request-who">
        <a className="request-name" href={osmProfile(r.name)} target="_blank" rel="noopener noreferrer">
          {r.name}
        </a>
        {r.osmAccount?.createdAt && <span className="hint"> · account {accountAge(r.osmAccount.createdAt)}</span>}
        {r.osmAccount?.changesets != null && <span className="hint"> · {r.osmAccount.changesets.toLocaleString()} edits</span>}
        <span className="hint"> · asked {new Date(r.createdAt).toLocaleDateString()}</span>
      </div>
      <dl className="request-answers">
        <dt className="request-q">Where</dt>
        <dd className="request-a">{r.place}</dd>
        <dt className="request-q">What</dt>
        <dd className="request-a">{r.subject}</dd>
        <dt className="request-q">Group</dt>
        <dd className="request-a">{r.group ?? <span className="hint">None given</span>}</dd>
      </dl>
      {open === undefined && (
        <div className="request-actions">
          <button type="button" onClick={() => setOpen("approve")}>
            Approve
          </button>
          <button type="button" onClick={() => setOpen("decline")}>
            Decline
          </button>
        </div>
      )}
      {open === "approve" && (
        <form
          className="request-decide"
          onSubmit={(e) => {
            e.preventDefault();
            if (projectName.trim()) void run(() => onApprove(r, projectName.trim()));
          }}
        >
          <label className="request-field">
            Project name
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} maxLength={200} />
          </label>
          <button type="submit" disabled={busy || !projectName.trim()}>
            Approve and make the project
          </button>
          <button type="button" className="link" onClick={() => setOpen(undefined)}>
            Cancel
          </button>
        </form>
      )}
      {open === "decline" && (
        <form
          className="request-decide"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => onDecline(r, note));
          }}
        >
          <label className="request-field">
            Note to them <span className="hint">(optional, they'll see it)</span>
            <textarea className="request-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} />
          </label>
          <button type="submit" disabled={busy}>
            Decline
          </button>
          <button type="button" className="link" onClick={() => setOpen(undefined)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}
