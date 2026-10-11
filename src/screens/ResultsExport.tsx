import { useState } from "react";
import { ApiError, fetchChallengeResults, type ResultsFormat } from "../api";
import { ErrorMessage } from "./ErrorMessage";

/** Download a campaign's results: every task with its status, answers and changeset. */
export function ResultsExport() {
  const [challengeId, setChallengeId] = useState("");
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<ResultsFormat>();
  const valid = /^[1-9][0-9]*$/.test(challengeId);

  const download = async (format: ResultsFormat) => {
    setError(undefined);
    setBusy(format);
    try {
      const { blob, filename } = await fetchChallengeResults(Number(challengeId), format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === "not_found" ? new Error(`No challenge with ID ${challengeId}.`) : cause);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="panel">
      <h3>Export results</h3>
      <p className="hint">Every task of the challenge with its status, who completed it and when, the chosen answers, the tags written and the OSM changeset.</p>
      <ErrorMessage error={error} />
      <label>Challenge ID <input inputMode="numeric" value={challengeId} onChange={(event) => setChallengeId(event.target.value.trim())} /></label>
      <button type="button" disabled={!valid || !!busy} onClick={() => void download("csv")}>{busy === "csv" ? "Exporting…" : "Download CSV"}</button>{" "}
      <button type="button" disabled={!valid || !!busy} onClick={() => void download("geojson")}>{busy === "geojson" ? "Exporting…" : "Download GeoJSON"}</button>
    </div>
  );
}
