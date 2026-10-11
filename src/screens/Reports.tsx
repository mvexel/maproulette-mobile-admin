import { useState } from "react";
import { ApiError, idEditorUrl, listReports, type StopReport } from "../api";
import { ErrorMessage } from "./ErrorMessage";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "Waiting to publish");

/** Stops mappers reported as not there or moved, with a link to fix each one in iD. */
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
      <p className="hint">Stops mappers said aren't there or have moved. They stay "Needs another look" until you fix the map. Open in iD goes to the stop, or to the reported spot for a moved stop.</p>
      <ErrorMessage error={error} />
      <form onSubmit={(event) => void load(event)}>
        <label>Challenge ID <input inputMode="numeric" value={challengeId} onChange={(event) => setChallengeId(event.target.value.trim())} /></label>
        <button type="submit" disabled={!valid || busy}>{busy ? "Loading…" : "Show reports"}</button>
      </form>
      {reports && reports.length === 0 && <p role="status">No reports for challenge {challengeId}.</p>}
      {reports && reports.length > 0 && (
          <table aria-label="Reports">
            <thead><tr><th>Stop</th><th>Report</th><th>When</th><th>Reports</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.taskId}>
                  <td>{r.label}<br /><a href={idEditorUrl(r.element, r.moved?.at ?? r.at)} target="_blank" rel="noreferrer">Open in iD</a></td>
                  <td>{r.outcomeLabel}{r.moved?.distanceM !== undefined && `, about ${r.moved.distanceM} m`}{r.moved && ` (${r.moved.source === "here" ? "from where they stood" : "tapped on the map"})`}</td>
                  <td>{when(r.reportedAt)}</td>
                  <td>{r.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
      )}
    </div>
  );
}
