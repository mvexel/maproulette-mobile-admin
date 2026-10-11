import { useState } from "react";
import { ApiError, idEditorUrl, listReports, type StopReport } from "../api";
import { shortDateTime } from "../format";
import { ErrorMessage } from "./ErrorMessage";

const when = (iso?: string) => (iso ? shortDateTime(iso) : "Waiting to publish");
const report = (r: StopReport) =>
  `${r.outcomeLabel}${r.moved?.distanceM !== undefined ? `, about ${r.moved.distanceM} m` : ""}${r.moved ? ` (${r.moved.source === "here" ? "from where they stood" : "tapped on the map"})` : ""}`;
const editor = (r: StopReport) => <a href={idEditorUrl(r.element, r.moved?.at ?? r.at)} target="_blank" rel="noreferrer">Open in iD</a>;
const stop = (r: StopReport) => <><span className="report-label">{r.label}</span><small className="report-element">{r.element}</small></>;

/** Stops people reported as not there or moved, with a link to fix each one in iD. */
export function Reports() {
  const [challengeId, setChallengeId] = useState("");
  const [reports, setReports] = useState<StopReport[]>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const valid = /^[1-9][0-9]*$/.test(challengeId);

  const load = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      setReports(await listReports(Number(challengeId)));
    } catch (cause) {
      setReports(undefined);
      setError(cause instanceof ApiError && cause.code === "not_found" ? new Error(`No challenge with ID ${challengeId}.`) : cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h3>Reports</h3>
      <p className="hint">Stops people reported as not there or moved. They stay “Needs another look” until you fix the map and put them back in the pool. Open in iD goes to the stop, or to the reported spot for a moved stop.</p>
      <ErrorMessage error={error} />
      <form onSubmit={(event) => void load(event)}>
        <label>Challenge ID <input inputMode="numeric" value={challengeId} onChange={(event) => setChallengeId(event.target.value.trim())} /></label>
        <button type="submit" disabled={!valid || busy}>{busy ? "Loading…" : "Show reports"}</button>
      </form>
      {reports && reports.length === 0 && <p role="status">No reports for challenge {challengeId}.</p>}
      {reports && reports.length > 0 && (
        <>
          <table className="reports-table" aria-label="Reports">
            <thead><tr><th>Stop</th><th>Report</th><th>When</th><th>Reports</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.taskId}>
                  <td>{stop(r)}{editor(r)}</td>
                  <td>{report(r)}</td>
                  <td>{when(r.reportedAt)}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="report-cards" aria-label="Reports">
            {reports.map((r) => (
              <li key={r.taskId}>
                {stop(r)}
                <span>{report(r)}</span>
                <span className="hint">{when(r.reportedAt)} · {r.count === 1 ? "1 report" : `${r.count} reports`}</span>
                {editor(r)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
