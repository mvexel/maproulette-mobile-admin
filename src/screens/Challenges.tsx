import { useState } from "react";
import { createChallenge, importChallengeTasks, type TaskImportReport } from "../api";
import { config } from "../config";
import { ErrorMessage } from "./ErrorMessage";

/** Super-user challenge setup. Task and OSM write policy remains independent. */
export function Challenges() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instruction, setInstruction] = useState("");
  const [checkinComment, setCheckinComment] = useState("");
  const [checkinSource, setCheckinSource] = useState("survey");
  const [challengeId, setChallengeId] = useState<number>();
  const [existingId, setExistingId] = useState("");
  const [file, setFile] = useState<File>();
  const [report, setReport] = useState<TaskImportReport>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const challenge = await createChallenge({ name, description, instruction, checkinComment, checkinSource });
      setChallengeId(challenge.id);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challengeId || !file) return;
    setError(undefined);
    setBusy(true);
    try {
      setReport(await importChallengeTasks(challengeId, file));
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Challenges</h2>
      <p className="hint">Create a challenge on <code>{config().backend}</code>, then upload one GeoJSON FeatureCollection per line. This does not enable mapper task or OSM edits.</p>
      <ErrorMessage error={error} />
      {!challengeId ? (
        <>
        <form className="panel" onSubmit={(event) => void create(event)}>
          <h3>New challenge</h3>
          <label>Name <input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>Description <textarea required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          <label>Instructions <textarea required value={instruction} onChange={(event) => setInstruction(event.target.value)} /></label>
          <label>OSM changeset comment <input value={checkinComment} onChange={(event) => setCheckinComment(event.target.value)} /></label>
          <label>OSM changeset source <input value={checkinSource} onChange={(event) => setCheckinSource(event.target.value)} /></label>
          <button type="submit" disabled={busy}>Create challenge</button>
        </form>
        <div className="panel">
          <h3>Continue an import</h3>
          <p className="hint">Use the challenge ID shown after creation if this page was reloaded.</p>
          <label>Challenge ID <input inputMode="numeric" value={existingId} onChange={(event) => setExistingId(event.target.value)} /></label>
          <button type="button" disabled={!/^[1-9][0-9]*$/.test(existingId)} onClick={() => setChallengeId(Number(existingId))}>Continue</button>
        </div>
        </>
      ) : (
        <div className="panel">
          <p role="status">Challenge {challengeId} created. Keep this page open until import finishes.</p>
          <form onSubmit={(event) => void upload(event)}>
            <label>Line-by-line GeoJSON file <input type="file" required accept=".geojsonl,.jsonl,.txt" onChange={(event) => setFile(event.target.files?.[0])} /></label>
            <button type="submit" disabled={busy || !file}>{busy ? "Importing…" : "Import tasks"}</button>
          </form>
          {report && <p role="status">Created {report.created}; updated {report.updated}; rejected {report.rejected.length}.</p>}
          {report?.rejected.map((item) => <p className="error" key={item.line}>Line {item.line}: {item.errors.join("; ")}</p>)}
          {report && <button type="button" onClick={() => { setChallengeId(undefined); setReport(undefined); setFile(undefined); }}>Create another challenge</button>}
        </div>
      )}
    </section>
  );
}
