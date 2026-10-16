import { useCallback, useEffect, useState } from "react";
import {
  type Campaign,
  type ChallengeDetail,
  fetchChallengeResults,
  getChallenge,
  getWritePolicy,
  listCampaigns,
  onWritePolicyChange,
  publishSurveyChallenge,
} from "../api";
import { role } from "../auth";
import { appLink, appState, type AppState, progressText, projectName, relativeTime, STATE_LABEL, webLink } from "../campaigns";
import { config } from "../config";
import { navigate } from "../router";
import { ErrorMessage } from "./ErrorMessage";
import { LivePanel } from "./LivePanel";
import { QueuePanel } from "./QueuePanel";
import { ProjectToggle } from "./Projects";
import { PublishSheet } from "./PublishSheet";
import { Reports } from "./Reports";
import { ShareLine } from "./Share";

function Link({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>();
  const [error, setError] = useState<unknown>();
  const reload = useCallback(async () => {
    try {
      setCampaigns(await listCampaigns());
      setError(undefined);
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  return { campaigns, error, reload };
}

const FILTERS = { all: "All", app: "In the app", drafts: "Drafts" } as const;
type Filter = keyof typeof FILTERS;
const matches = (f: Filter, s: AppState) => f === "all" || (f === "app" ? s === "listed" : s === "draft");

/** The home page: every choice campaign on this backend and where it stands in the app. */
export function CampaignList() {
  const { campaigns, error } = useCampaigns();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = campaigns?.filter((c) => matches(filter, appState(c)));
  return (
    <section>
      <h2>
        Campaigns{" "}
        {role() === "admin" && (
          <button type="button" onClick={() => navigate("/new")}>
            New campaign
          </button>
        )}
      </h2>
      <p className="hint">
        Choice campaigns on <code>{config().backend}</code>.
      </p>
      <fieldset className="filters">
        <legend className="visually-hidden">Show</legend>
        {(Object.keys(FILTERS) as Filter[]).map((f) => (
          <label key={f} className={filter === f ? "on" : undefined}>
            <input type="radio" className="filter-input" name="campaign-filter" checked={filter === f} onChange={() => setFilter(f)} />
            {FILTERS[f]}
            {campaigns && <span className="count">{campaigns.filter((c) => matches(f, appState(c))).length}</span>}
          </label>
        ))}
      </fieldset>
      <ErrorMessage error={error} />
      {!campaigns && !error && <p>Loading campaigns…</p>}
      {shown && shown.length === 0 && (
        <p className="hint">{filter === "all" ? "No choice campaigns on this backend yet." : "None match this filter."}</p>
      )}
      {shown && shown.length > 0 && (
        <table className="campaigns">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Project</th>
              <th>In the app</th>
              <th>Progress</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const state = appState(c);
              return (
                <tr key={c.id} data-campaign={c.id}>
                  <td data-label="Campaign">
                    <Link to={`/campaigns/${c.id}`}>{c.name}</Link> <small className="hint">{c.id}</small>
                  </td>
                  <td data-label="Project">
                    <span>
                      {projectName(c.project)}
                      {!c.project.enabled && <span className="tag tag-off">Project off</span>}
                    </span>
                  </td>
                  <td data-label="In the app">
                    <span className={`state state-${state}`}>{STATE_LABEL[state]}</span>
                  </td>
                  <td data-label="Progress">{progressText(c.tasks)}</td>
                  <td data-label="Updated">
                    <time dateTime={c.modified} title={c.modified}>
                      {relativeTime(c.modified)}
                    </time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** One campaign: what a participant sees, how to share it, progress, export and its texts. */
export function CampaignPage({ id }: { id: number }) {
  const { campaigns, error, reload } = useCampaigns();
  const [challenge, setChallenge] = useState<ChallengeDetail>();
  const [textsError, setTextsError] = useState<unknown>();
  const [writes, setWrites] = useState<boolean>();
  const [sheet, setSheet] = useState<"publish" | "project">();
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState<unknown>();
  useEffect(() => {
    getChallenge(id).then(setChallenge, setTextsError);
    getWritePolicy().then(
      (p) => setWrites(p.enabled),
      () => setWrites(undefined),
    );
    return onWritePolicyChange((p) => setWrites(p.enabled));
  }, [id]);
  const c = campaigns?.find((x) => x.id === id);

  if (error) return <ErrorMessage error={error} />;
  if (!campaigns) return <p>Loading campaign…</p>;
  if (!c)
    return (
      <section>
        <h2>Campaign {id}</h2>
        <p>
          No choice campaign {id} on this backend. <Link to="/">Back to Campaigns</Link>
        </p>
      </section>
    );

  const state = appState(c);
  const env = config().environment?.toUpperCase();
  const writesOff = state === "listed" && writes === false;
  // Publishing writes through a stock route; organizers publish from the campaign wizard instead.
  const canPublish = role() === "admin";
  const QR_WARNING: Partial<Record<AppState, string>> = {
    draft: "Not in the app yet. This code won't work until you publish.",
    "not-published": "Hidden from the app. This code won't work until you publish.",
    "project-off": "Hidden from the app. This code won't work until the project is on.",
    "turned-off": "Hidden from the app. This code won't work until the challenge is on.",
  };

  async function download(format: "csv" | "geojson") {
    setActionError(undefined);
    try {
      const { blob, filename } = await fetchChallengeResults(id, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setActionError(e);
    }
  }

  return (
    <section className="campaign">
      <p className="crumbs">
        <Link to="/">Campaigns</Link>
      </p>
      <h2>
        {c.name} <small className="hint">Challenge {c.id}</small>
      </h2>
      <div className={`status-line state-${state}${writesOff ? " writes-off" : ""}`} role="status">
        {state === "listed" && (
          <p>
            {writes === undefined
              ? "Listed in the app."
              : writes
                ? "Listed in the app. Task writes are on for this backend."
                : `Listed in the app, but task writes are off on ${env ?? "this backend"}: people can open it but can't save yet.`}
          </p>
        )}
        {state === "project-off" && (
          <p>
            Hidden from the app: project “{c.project.name}” is off.{" "}
            <button type="button" className="primary" onClick={() => setSheet("project")}>
              Turn project on
            </button>
          </p>
        )}
        {state === "turned-off" && <p>Hidden from the app: the challenge is turned off.</p>}
        {state === "not-published" && (
          <p>
            Hidden from the app: not published yet.{" "}
            {canPublish && (
              <button type="button" className="primary" onClick={() => setSheet("publish")} disabled={!challenge}>
                Publish
              </button>
            )}
          </p>
        )}
        {state === "draft" && (
          <p>
            Draft: not in the app yet.{" "}
            {canPublish && (
              <button type="button" className="primary" onClick={() => setSheet("publish")} disabled={!challenge}>
                Publish
              </button>
            )}
          </p>
        )}
      </div>
      {notice && <p className="notice">{notice}</p>}
      <ErrorMessage error={actionError} />

      <div className="panel">
        <h3>Share</h3>
        <ShareLine label="App link" url={appLink(c.id)} file={`campaign-${c.id}-app-qr.png`} warning={QR_WARNING[state]} />
        <ShareLine
          label="Web link"
          url={webLink(c.id)}
          file={`campaign-${c.id}-web-qr.png`}
          note="Doesn't open the app yet: needs the App Store build. Don't print this one."
        />
      </div>

      <div className="panel">
        <h3>Progress</h3>
        <p className="progress-line">{progressText(c.tasks)}</p>
        {c.tasks.total > 0 && (
          <progress max={c.tasks.total} value={c.tasks.checked} aria-label="Tasks checked">
            {c.tasks.checked} of {c.tasks.total}
          </progress>
        )}
      </div>

      <LivePanel challenge={c.id} />

      <Reports challenge={c.id} />

      <QueuePanel challenge={c.id} />

      <div className="panel">
        <h3>Export</h3>
        <p className="hint">Every task with its status, who checked it, and the answers given.</p>
        <button type="button" onClick={() => void download("csv")}>
          Download CSV
        </button>{" "}
        <button type="button" onClick={() => void download("geojson")}>
          Download GeoJSON
        </button>
      </div>

      <div className="panel">
        <h3>Texts</h3>
        <ErrorMessage error={textsError} />
        {!challenge && !textsError && <p>Loading texts…</p>}
        {challenge && (
          <div className="texts">
            <figure className="welcome-card">
              <figcaption className="hint">Welcome card in the app{env ? ` on ${env}` : ""}</figcaption>
              <h4>{challenge.name}</h4>
              <p>{challenge.description}</p>
            </figure>
            <dl>
              <dt>Description</dt>
              <dd>{challenge.description || <em>None</em>}</dd>
              <dt>Instruction</dt>
              <dd>{challenge.instruction || <em>None</em>}</dd>
              <dt>Changeset comment</dt>
              <dd>
                <code>{challenge.checkinComment || "none"}</code>
              </dd>
              <dt>Changeset source</dt>
              <dd>
                <code>{challenge.checkinSource || "none"}</code>
              </dd>
            </dl>
          </div>
        )}
      </div>

      {sheet === "project" && (
        <ProjectToggle
          project={c.project}
          enable
          onCancel={() => setSheet(undefined)}
          onDone={() => {
            setSheet(undefined);
            setNotice(`Project “${c.project.name}” is on.`);
            void reload();
          }}
        />
      )}
      {sheet === "publish" && challenge && (
        <PublishSheet
          projectId={c.project.id}
          input={{
            checkinComment: challenge.checkinComment ?? "",
            checkinSource: challenge.checkinSource ?? "",
            description: challenge.description ?? "",
          }}
          onCancel={() => setSheet(undefined)}
          onPublish={async () => {
            try {
              await publishSurveyChallenge(id);
              setSheet(undefined);
              setNotice("Published to the app. Task writes are unchanged.");
              await reload();
            } catch (e) {
              setSheet(undefined);
              setActionError(e);
              setNotice(`Publication was attempted. Check challenge ${id} and its audit record before retrying.`);
            }
          }}
        />
      )}
    </section>
  );
}
