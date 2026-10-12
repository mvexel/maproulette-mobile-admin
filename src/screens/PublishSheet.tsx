import { useEffect, useState } from "react";
import { describeError, getWritePolicy, listProjects, type Project } from "../api";
import { config } from "../config";
import { type Check, canPublish, type PublishInput, publishChecks } from "../publish";
import { ProjectToggle, Sheet } from "./Projects";

const MARK: Record<Check["kind"], string> = { pass: "✓", block: "✕", warning: "!", info: "i" };

/**
 * The checks before a campaign goes live (design pass §4). Blocks disable Publish, warnings need a
 * tick, and an off project can be turned on from here.
 */
export function PublishSheet({
  projectId,
  input,
  waiting = false,
  onPublish,
  onCancel,
}: {
  projectId: number;
  input: Omit<PublishInput, "project" | "writesEnabled" | "environment">;
  /** A check's input is still loading: hold the checks, and Publish, until it settles. */
  waiting?: boolean;
  onPublish: () => Promise<void>;
  onCancel: () => void;
}) {
  const [project, setProject] = useState<Project | null>();
  const [writesEnabled, setWritesEnabled] = useState<boolean>();
  const [loadError, setLoadError] = useState<string>();
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [toggling, setToggling] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listProjects()
      .then((all) => setProject(all.find((p) => p.id === projectId) ?? null))
      .catch((e: unknown) => setLoadError(describeError(e).message));
    // The policy is informational; a deployment without it just omits the line.
    getWritePolicy()
      .then((p) => setWritesEnabled(p.enabled))
      .catch(() => setWritesEnabled(undefined));
  }, [projectId]);

  const loading = (project === undefined && !loadError) || waiting;
  const checks = loading
    ? []
    : publishChecks({
        ...input,
        project: project ?? undefined,
        writesEnabled,
        environment: config().environment,
      });
  const ready = !loading && canPublish(checks, ticked);
  const tick = (id: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function publish() {
    setBusy(true);
    try {
      await onPublish();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title="Publish to the app?" onClose={onCancel}>
      {loading && <p>Checking the campaign…</p>}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.id} className={`check check-${c.kind}`} data-check={c.id}>
            <span className="check-mark" aria-hidden="true">
              {MARK[c.kind]}
            </span>
            {c.kind === "warning" ? (
              <label className="check-tick">
                <input type="checkbox" checked={ticked.has(c.id)} onChange={(e) => tick(c.id, e.target.checked)} />
                <span>
                  {c.text} <span className="hint">Tick to publish anyway.</span>
                </span>
              </label>
            ) : c.strong ? (
              <strong>{c.text}</strong>
            ) : (
              <span>{c.text}</span>
            )}
            {c.fix === "turn-on-project" && (
              <button type="button" className="check-fix" onClick={() => setToggling(true)}>
                Turn on project
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="sheet-actions">
        <button type="button" className="primary" disabled={!ready || busy} onClick={() => void publish()}>
          Publish to the app
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {toggling && project && (
        <ProjectToggle
          project={project}
          enable
          onCancel={() => setToggling(false)}
          onDone={(p) => {
            setToggling(false);
            setProject(p);
          }}
        />
      )}
    </Sheet>
  );
}
