import { useCallback, useEffect, useState } from "react";
import {
  addOrganizer,
  listOrganizers,
  type Organizer,
  type OrganizerRole,
  removeOrganizer,
  removeOrganizerProject,
} from "../api";
import { ErrorMessage } from "./ErrorMessage";
import { useProjects } from "./Projects";

/**
 * Super-users only: who may run campaigns (D8, organizer-admin.md §4.1). Adding someone gives them
 * a role on a project and puts them on the organizer list; they then sign in to this app and see
 * that project's campaigns only.
 */
export function Organizers() {
  const [organizers, setOrganizers] = useState<Organizer[]>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(() => {
    listOrganizers()
      .then(setOrganizers)
      .catch((e: unknown) => setError(e));
  }, []);
  useEffect(reload, [reload]);

  const act = async (work: () => Promise<string>) => {
    setError(undefined);
    setNotice(undefined);
    try {
      setNotice(await work());
      reload();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <section>
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
