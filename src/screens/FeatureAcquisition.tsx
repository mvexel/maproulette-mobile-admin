import { useCallback, useEffect, useRef, useState } from "react";
import { type Area, bboxArea, parseBoundary, parseRules, rulesFromMatch, MAX_BOUNDARY_BYTES } from "../acquisition";
import { config } from "../config";
import { cancelJob, createJob, describeJobError, getJobFeatures, isActive, type Job, listJobs } from "../jobs";

interface Props {
  /** Current survey identity tags (JSON text from the editor). */
  match: string;
  challengeName: string;
  /** True once a challenge was created: loading features is then blocked. */
  locked: boolean;
  /** Receives the validated FeatureCollection; returns problems if it was refused. */
  onLoad(fc: { type: "FeatureCollection"; features: unknown[] }): string[];
}

/** Rule rows keep their ids across edits so React can track them; new rows get fresh ids. */
const withIds = (texts: string[], prev: { id: string; text: string }[] = []) => texts.map((text, i) => ({ id: prev.length === texts.length ? prev[i].id : crypto.randomUUID(), text }));
const parsedMatch = (text: string) => { try { return JSON.parse(text) as unknown; } catch { return {}; } };

export function FeatureAcquisition({ match, challengeName, locked, onLoad }: Props) {
  const [mode, setMode] = useState<"file" | "bbox">("bbox");
  const [box, setBox] = useState({ south: "", west: "", north: "", east: "" });
  const [boundary, setBoundary] = useState<Area>();
  const [boundaryName, setBoundaryName] = useState("");
  const [rules, setRulesState] = useState<{ id: string; text: string }[]>(() => withIds(rulesFromMatch(parsedMatch(match))));
  const setRules = (next: string[] | ((rs: string[]) => string[])) => setRulesState(cur => withIds(typeof next === "function" ? next(cur.map(r => r.text)) : next, cur));
  const [rulesEdited, setRulesEdited] = useState(false);
  const [name, setName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [listError, setListError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reviewId, setReviewId] = useState<string>();
  const [notice, setNotice] = useState("");
  const stop = useRef(false);

  useEffect(() => { if (!rulesEdited) setRulesState(withIds(rulesFromMatch(parsedMatch(match)))); }, [match, rulesEdited]);

  const refresh = useCallback(async () => {
    try { setJobs(await listJobs()); setListError(""); } catch (e) { setListError(describeJobError(e)); }
    setLoaded(true);
  }, []);

  // The list comes from the server, so a reload finds running jobs again. Poll while any is active.
  const active = jobs.some(j => isActive(j.state));
  useEffect(() => { stop.current = false; void refresh(); return () => { stop.current = true; }; }, [refresh]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => { if (!stop.current) void refresh(); }, config().jobsPollMs ?? 2000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const area: Area | string[] | undefined = mode === "bbox"
    ? ([box.south, box.west, box.north, box.east].every(v => v === "") ? undefined : bboxArea([box.south, box.west, box.north, box.east]))
    : boundary;
  const parsedRules = parseRules(rules.map(r => r.text));
  const areaProblems = Array.isArray(area) ? area : [];
  const validArea = area && !Array.isArray(area) ? area : undefined;
  const canQueue = !busy && !!validArea && parsedRules.problems.length === 0;

  async function readBoundary(file: File | undefined) {
    if (!file) return;
    setBoundary(undefined); setBoundaryName("");
    try {
      if (file.size > MAX_BOUNDARY_BYTES) throw new Error(`Boundary file exceeds ${MAX_BOUNDARY_BYTES / 1024 / 1024} MiB. Simplify it first.`);
      setBoundary(parseBoundary(await file.text())); setBoundaryName(file.name); setErrors([]);
    } catch (e) { setErrors([e instanceof Error ? e.message : String(e)]); }
  }

  async function queue() {
    if (!validArea) return;
    setBusy(true); setErrors([]); setNotice("");
    try {
      const job = await createJob({ name: (name.trim() || challengeName || "Feature search").slice(0, 100), region: validArea.region, rules: parsedRules.rules });
      setJobs(js => [job, ...js.filter(j => j.id !== job.id)]);
      setNotice("Search queued. It keeps running if you close this page.");
    } catch (e) {
      // Never resubmitted automatically: a lost response may still have queued a job.
      setErrors([describeJobError(e), "If the request was interrupted, check the job list before queueing again."]);
      void refresh();
    } finally { setBusy(false); }
  }

  async function cancel(id: string) {
    try { const job = await cancelJob(id); setJobs(js => js.map(j => j.id === id ? job : j)); } catch (e) { setErrors([describeJobError(e)]); }
  }

  async function load(job: Job) {
    setBusy(true); setErrors([]); setNotice("");
    try {
      const fc = await getJobFeatures(job.id);
      const problems = onLoad(fc);
      if (problems.length) setErrors(problems); else setNotice(`Loaded ${fc.features.length} features into the preview. Review the generated tasks below.`);
    } catch (e) { setErrors([describeJobError(e)]); void refresh(); } finally { setBusy(false); }
  }

  const review = jobs.find(j => j.id === reviewId && j.state === "complete" && j.result);

  return <section className="panel" aria-labelledby="acq-heading">
    <h3 id="acq-heading">Find features in an area</h3>
    <p>Looks up OpenStreetMap features matching your rules inside an area and builds the feature list for you. This takes a few minutes and runs on the server. To use a feature file you already have, use <em>Open feature file</em> below instead.</p>
    {notice && <p role="status" className="notice">{notice}</p>}
    {errors.length > 0 && <div role="alert" className="error">{errors.map(e => <p key={e}>{e}</p>)}</div>}
    <fieldset className="option-editor">
      <legend>Area</legend>
      <div className="survey-toolbar">
        <label><input type="radio" name="acq-mode" checked={mode === "bbox"} onChange={() => setMode("bbox")} /> Bounding box</label>
        <label><input type="radio" name="acq-mode" checked={mode === "file"} onChange={() => setMode("file")} /> Upload area boundary</label>
      </div>
      {mode === "bbox" ? <div className="bbox-inputs">
        {(["south", "west", "north", "east"] as const).map(k => <label key={k}>{k[0].toUpperCase() + k.slice(1)} (degrees)<input inputMode="decimal" value={box[k]} onChange={e => setBox(b => ({ ...b, [k]: e.target.value }))} /></label>)}
      </div> : <label>Area boundary file (GeoJSON polygon)<input type="file" accept=".json,.geojson" onChange={e => { void readBoundary(e.target.files?.[0]); e.target.value = ""; }} /></label>}
      {areaProblems.length > 0 && <div className="error">{areaProblems.map(p => <p key={p}>{p}</p>)}</div>}
      {validArea && <p className="hint">{mode === "file" && boundaryName ? `${boundaryName}: ` : ""}{validArea.vertices.toLocaleString("en")} vertices, bounding box area about {Math.round(validArea.areaKm2).toLocaleString("en")} km2.</p>}
      {validArea?.warnings.map(w => <p role="status" className="notice" key={w}>{w}</p>)}
    </fieldset>
    <fieldset className="option-editor">
      <legend>Identity rules</legend>
      <p className="hint">A feature is kept if it matches any rule. Within a rule, every key=value line must match; use * for any value. Rules start from the survey's identity tags and are frozen into the job when you queue it.</p>
      {rules.map((r, i) => <div key={r.id} className="survey-toolbar">
        <label>Rule {i + 1}<textarea aria-label={`Rule ${i + 1}`} className="tag-input" rows={2} value={r.text} onChange={e => { setRulesEdited(true); setRules(rs => rs.map((x, j) => j === i ? e.target.value : x)); }} /></label>
        <button type="button" disabled={rules.length <= 1} onClick={() => { setRulesEdited(true); setRules(rs => rs.filter((_, j) => j !== i)); }}>Remove rule {i + 1}</button>
      </div>)}
      <div className="survey-toolbar">
        <button type="button" disabled={rules.length >= 10} onClick={() => { setRulesEdited(true); setRules(rs => [...rs, ""]); }}>Add alternative rule</button>
        <button type="button" onClick={() => { setRulesEdited(false); setRules(rulesFromMatch(parsedMatch(match))); }}>Use survey identity tags</button>
      </div>
      {parsedRules.problems.map(p => <p className="error" key={p}>{p}</p>)}
    </fieldset>
    <label>Search name<input value={name} placeholder={challengeName} onChange={e => setName(e.target.value)} /></label>
    <div className="survey-toolbar"><button type="button" disabled={!canQueue} onClick={() => void queue()}>Queue feature search</button></div>

    <h4>Feature searches</h4>
    {listError && <p className="error" role="alert">Could not load searches: {listError}</p>}
    {loaded && jobs.length === 0 && !listError && <p className="hint">No searches yet.</p>}
    <ul className="job-list">{jobs.map(j => <li key={j.id} data-state={j.state}>
      <strong>{j.input.name}</strong> <span className="hint">{j.state}{j.progress.fraction != null && isActive(j.state) ? ` ${Math.round(j.progress.fraction * 100)}%` : ""}</span>
      {isActive(j.state) && <p className="hint">{j.progress.message}</p>}
      {j.state === "failed" && j.error && <p className="error" role="alert">Failed ({j.error.code}): {j.error.message}</p>}
      {j.state === "cancelled" && <p className="hint">Cancelled.</p>}
      {j.state === "expired" && <p className="hint">Results expired. Queue the search again.</p>}
      <div className="survey-toolbar">
        {isActive(j.state) && <button type="button" onClick={() => void cancel(j.id)}>Cancel search</button>}
        {j.state === "complete" && <button type="button" onClick={() => setReviewId(j.id)}>Review results</button>}
      </div>
    </li>)}</ul>

    {review?.result && <section className="job-review" aria-label="Search results">
      <h4>Results: {review.input.name}</h4>
      <p><strong>{review.result.featureCount}</strong> features found.</p>
      <p className="hint">Candidates {review.result.counts.candidates}, emitted {review.result.counts.emitted}, duplicates {review.result.counts.duplicates}, outside area {review.result.counts.outside_region}, omitted {review.result.counts.omitted}.</p>
      <p className="hint">OpenStreetMap data as of {review.result.provenance.sourceTimestamp ?? "unknown"}.</p>
      {review.result.omissionTotal > 0 && <details><summary>{review.result.omissionTotal} omitted features</summary>
        <ul>{review.result.omissions.map(o => <li key={o.id}><code>{o.id}</code> {o.reason}: {o.detail}</li>)}</ul>
        {review.result.omissionTotal > review.result.omissions.length && <p className="hint">Showing the first {review.result.omissions.length}.</p>}</details>}
      <details><summary>Provenance</summary><pre>{JSON.stringify(review.result.provenance, null, 2)}</pre></details>
      <button type="button" disabled={locked || busy} onClick={() => void load(review)}>Load {review.result.featureCount} features into preview</button>
      {locked && <p className="hint">A challenge was already created from this survey; features can no longer be replaced.</p>}
      <p className="hint">This replaces the feature list above. Nothing is sent to MapRoulette until you create and import a challenge.</p>
    </section>}
  </section>;
}
