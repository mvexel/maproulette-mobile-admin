import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  type Campaign,
  createProject,
  describeError,
  listCampaigns,
  listProjects,
  type Project,
  setProjectEnabled,
} from "../api";
import { role } from "../auth";
import { config } from "../config";

const envName = () => config().environment?.toUpperCase() ?? config().backend;

/** The projects on this backend, reloadable after a change. */
export function useProjects() {
  const [projects, setProjects] = useState<Project[]>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    try {
      setProjects(await listProjects());
      setError(undefined);
    } catch (e) {
      setError(describeError(e).message);
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { projects, error, reload, setProjects };
}

/** A modal sheet: the browser's dialog, opened as soon as it mounts. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog ref={ref} className="sheet" aria-label={title} onCancel={onClose}>
      <h3>{title}</h3>
      {children}
    </dialog>
  );
}

/**
 * Asks once before turning a project on or off, naming what changes in the app. Calls `onDone`
 * with the updated project; the change is in the audit log.
 */
export function ProjectToggle({
  project,
  enable,
  onDone,
  onCancel,
}: {
  project: Pick<Project, "id" | "name">;
  enable: boolean;
  onDone: (p: Project) => void;
  onCancel: () => void;
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    listCampaigns()
      .then((all) => setCampaigns(all.filter((c) => c.project.id === project.id)))
      .catch((e: unknown) => setError(describeError(e).message));
  }, [project.id]);
  const shown = campaigns?.filter((c) => (enable ? c.enabled && c.published : c.listed)) ?? [];
  const n = shown.length;
  async function confirm() {
    setBusy(true);
    setError(undefined);
    try {
      onDone(await setProjectEnabled(project.id, enable));
    } catch (e) {
      setError(describeError(e).message);
      setBusy(false);
    }
  }
  return (
    <Sheet title={`Turn ${enable ? "on" : "off"} project “${project.name}”?`} onClose={onCancel}>
      {campaigns === undefined && !error ? (
        <p>Loading its campaigns…</p>
      ) : enable ? (
        <p>
          {n === 0
            ? "It has no published campaigns yet."
            : `Its ${n} published ${n === 1 ? "campaign" : "campaigns"} will show in the app on ${envName()}.`}{" "}
          Task writes are unchanged.
        </p>
      ) : (
        <p>
          {n === 0
            ? "None of its campaigns are listed in the app, so nothing disappears."
            : `${n === 1 ? "This listed campaign" : `These ${n} listed campaigns`} will disappear from the app: ${shown.map((c) => c.name).join(", ")}.`}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="primary" disabled={busy || campaigns === undefined} onClick={() => void confirm()}>
          {campaigns === undefined && !error ? "Loading…" : `Turn ${enable ? "on" : "off"}`}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Picks the project for a new campaign: the projects on this backend, with off ones marked and a
 * way to turn one on, a New project form, and raw ID entry under Advanced.
 */
export function ProjectPicker({ value, onChange }: { value?: number; onChange: (id: number | undefined) => void }) {
  const { projects, error, reload } = useProjects();
  const [toggling, setToggling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [createError, setCreateError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [rawId, setRawId] = useState("");
  const selected = projects?.find((p) => p.id === value);
  const admin = role() === "admin";

  async function create() {
    setBusy(true);
    setCreateError(undefined);
    try {
      const p = await createProject(name.trim(), displayName.trim() || undefined);
      await reload();
      onChange(p.id);
      setCreating(false);
      setName("");
      setDisplayName("");
    } catch (e) {
      const d = describeError(e);
      setCreateError(
        e instanceof ApiError && e.code === "project_exists"
          ? `A project named “${name.trim()}” already exists.`
          : [d.message, ...d.detail].join(" "),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="project-picker">
      <div className="project-row">
        <label>
          Project
          <select
            value={value ?? ""}
            disabled={!projects}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">{projects ? "Pick a project" : "Loading projects…"}</option>
            {projects?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName || p.name}
                {p.enabled ? "" : " (off: its campaigns are hidden in the app)"}
              </option>
            ))}
            {value !== undefined && projects && !selected && <option value={value}>Project {value} (entered by ID)</option>}
          </select>
        </label>
        {/* Organizers run the projects they were given; creating projects stays with super-users. */}
        {admin && (
          <button type="button" onClick={() => setCreating(!creating)} aria-expanded={creating}>
            New project
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {selected && !selected.enabled && (
        <p className="notice project-off" role="status">
          Project “{selected.name}” is off, so this campaign won't show in the app until it's on.{" "}
          <button type="button" onClick={() => setToggling(true)}>
            Turn it on
          </button>
        </p>
      )}
      {creating && (
        <fieldset className="new-project">
          <legend>New project</legend>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <p className="hint">The project is created on, so its published campaigns show in the app.</p>
          {createError && (
            <p className="error" role="alert">
              {createError}
            </p>
          )}
          <button type="button" disabled={busy || !name.trim()} onClick={() => void create()}>
            Create project
          </button>
        </fieldset>
      )}
{admin && (
      <details className="advanced">
        <summary>Advanced: enter a project ID</summary>
        <p className="hint">For a project the list can't show. Project IDs differ between backends.</p>
        <label>
          Project ID on this backend
          <input inputMode="numeric" value={rawId} onChange={(e) => setRawId(e.target.value)} />
        </label>
        <button
          type="button"
          disabled={!/^[1-9][0-9]{0,15}$/.test(rawId)}
          onClick={() => onChange(Number(rawId))}
        >
          Use this ID
        </button>
      </details>
)}
      {toggling && selected && (
        <ProjectToggle
          project={selected}
          enable
          onCancel={() => setToggling(false)}
          onDone={() => {
            setToggling(false);
            void reload();
          }}
        />
      )}
    </div>
  );
}
