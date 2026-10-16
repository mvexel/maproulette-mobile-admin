import { useCallback, useEffect, useState } from "react";
import { addOrganizer, listOrganizers, type Organizer, removeOrganizer, removeOrganizerProject } from "../api";
import { config } from "../config";
import { shortDateTime } from "../format";
import { ErrorMessage } from "./ErrorMessage";
import { useProjects } from "./Projects";

/**
 * Super-users keep the organizer list (backend docs/mobile-admin-api.md, Organizers): who may sign
 * in with mobile:organize, and on which projects they hold Write or Admin.
 */
export function Organizers() {
  const [organizers, setOrganizers] = useState<Organizer[]>();
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState<string>();
  const [removing, setRemoving] = useState<Organizer>();

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
    } catch (e) {
      setError(e);
    }
    reload();
  };

  return (
    <section className="organizers">
      <h2>Organizers</h2>
      <p className="hint">
        Organizers sign in here to run the campaigns of their projects. They don't see clients, task writes or the audit log.
      </p>
      <AddOrganizer onAdded={(o, project) => void act(async () => `Added ${o.name} to ${project}.`)} onError={setError} />
      <ErrorMessage error={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {removing && (
        <div className="panel" role="dialog" aria-label={`Remove ${removing.name}?`}>
          <p>
            {removing.name} can no longer sign in here. Their roles on MapRoulette projects stay; remove those first if they shouldn't keep them.
          </p>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const o = removing;
              setRemoving(undefined);
              void act(async () => {
                await removeOrganizer(o.userId);
                return `Removed ${o.name}. They can no longer sign in here.`;
              });
            }}
          >
            Remove
          </button>{" "}
          <button type="button" onClick={() => setRemoving(undefined)}>
            Cancel
          </button>
        </div>
      )}
      {!organizers ? (
        !error && <p>Loading…</p>
      ) : organizers.length === 0 ? (
        <p>No organizers yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Organizer</th>
              <th>Projects</th>
              <th>Added</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {organizers.map((o) => (
              <tr key={o.userId} data-organizer={o.userId}>
                <td>
                  <a href={`${config().osmWeb}/user/${encodeURIComponent(o.name)}`} target="_blank" rel="noopener noreferrer">
                    {o.name}
                  </a>
                </td>
                <td>
                  {o.projects.length === 0 ? (
                    <span className="hint">No projects: they can sign in but see no campaigns.</span>
                  ) : (
                    <ul className="org-projects">
                      {o.projects.map((p) => (
                        <li key={p.id}>
                          {p.displayName || p.name} <span className="hint">{p.role === "admin" ? "Admin" : "Write"}</span>{" "}
                          <button
                            type="button"
                            aria-label={`Remove ${o.name} from ${p.displayName || p.name}`}
                            onClick={() =>
                              void act(async () => {
                                await removeOrganizerProject(o.userId, p.id);
                                return `${o.name} no longer runs ${p.displayName || p.name}.`;
                              })
                            }
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>{shortDateTime(o.createdAt)}</td>
                <td className="actions">
                  <button type="button" onClick={() => setRemoving(o)}>
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

function AddOrganizer({ onAdded, onError }: { onAdded: (o: Organizer, project: string) => void; onError: (e: unknown) => void }) {
  const { projects, error } = useProjects();
  const [username, setUsername] = useState("");
  const [projectId, setProjectId] = useState<number>();
  const [role, setRole] = useState<"write" | "admin">("write");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (projectId === undefined) return;
    setBusy(true);
    try {
      const o = await addOrganizer(username.trim(), projectId, role);
      const p = projects?.find((x) => x.id === projectId);
      setUsername("");
      onAdded(o, p ? p.displayName || p.name : `project ${projectId}`);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel add-organizer" aria-label="Add an organizer" onSubmit={submit}>
      <label>
        OpenStreetMap username
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Project
        <select value={projectId ?? ""} disabled={!projects} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">{projects ? "Pick a project" : "Loading projects…"}</option>
          {projects?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName || p.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Role on the project</legend>
        <label>
          <input type="radio" name="role" checked={role === "write"} onChange={() => setRole("write")} /> Runs campaigns (Write)
        </label>
        <label>
          <input type="radio" name="role" checked={role === "admin"} onChange={() => setRole("admin")} /> Also manages the project (Admin)
        </label>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <p className="hint">
        They need to have signed in to MapRoulette once. Adding someone who is already an organizer gives them another project.
      </p>
      <button type="submit" className="primary" disabled={busy || !username.trim() || projectId === undefined}>
        {busy ? "Adding…" : "Add organizer"}
      </button>
    </form>
  );
}
