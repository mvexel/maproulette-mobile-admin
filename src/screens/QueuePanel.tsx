import { useState } from "react";
import { fetchQueueExport, generateQueue, type QueueReport } from "../api";
import { queueSummary } from "../campaigns";
import { ErrorMessage } from "./ErrorMessage";

/**
 * The confirm queue (H1b): answers every guest agreed on become a tag-fix challenge that mappers
 * work on maproulette.org. Checking reads OpenStreetMap and never writes to it.
 */
export function QueuePanel({ challenge }: { challenge: number }) {
  const [report, setReport] = useState<QueueReport>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState<"check" | "download">();
  const [empty, setEmpty] = useState(false);

  async function check() {
    setError(undefined);
    setEmpty(false);
    setBusy("check");
    try {
      setReport(await generateQueue(challenge));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  }

  async function download() {
    setError(undefined);
    setBusy("download");
    try {
      const file = await fetchQueueExport(challenge);
      if (!file) {
        setEmpty(true);
        return;
      }
      const url = URL.createObjectURL(file.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <div className="panel queue-panel">
      <h3>Confirm queue</h3>
      <p className="hint">
        Answers that everyone agreed on, for a mapper to confirm and add to OpenStreetMap on maproulette.org. Each place is checked on
        OpenStreetMap first; places that changed since the survey are left out. Nothing is written to OpenStreetMap from here.
      </p>
      <ErrorMessage error={error} />
      <p>
        <button type="button" className="primary" disabled={!!busy} onClick={() => void check()}>
          {busy === "check" ? "Checking OpenStreetMap…" : "Check answers and update the queue"}
        </button>{" "}
        <button type="button" disabled={!!busy} onClick={() => void download()}>
          {busy === "download" ? "Downloading…" : "Download for maproulette.org"}
        </button>
      </p>
      {report && (
        <p className="queue-summary" role="status">
          {queueSummary(report)}
        </p>
      )}
      {empty && (
        <p className="queue-summary" role="status">
          Nothing in the queue yet. Check the answers first.
        </p>
      )}
      <p className="hint">On maproulette.org, create a challenge and upload the file as GeoJSON with “line-by-line” turned on.</p>
    </div>
  );
}
