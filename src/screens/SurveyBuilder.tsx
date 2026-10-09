import { useMemo, useState } from "react";
import { createSurveyChallenge, describeError, importChallengeTasks, publishSurveyChallenge, type TaskImportReport } from "../api";
import { config } from "../config";
import { exampleSurvey, generateTasks, parseSurvey, type SurveyDocument, SurveyValidationError } from "../survey";

interface OptionDraft { key: string; id: string; label: string; description: string; setTags: string; unsetTags: string }
interface QuestionDraft { key: string; id: string; prompt: string; description: string; expect: string; options: OptionDraft[] }
interface Draft { challenge: SurveyDocument["challenge"]; match: string; features: string; questions: QuestionDraft[] }
const pretty = (v: unknown) => JSON.stringify(v, null, 2);
function draftOf(s: SurveyDocument): Draft {
  return { challenge: { ...s.challenge }, match: pretty(s.match), features: pretty(s.features), questions: s.questions.map(q => ({ ...q, key: crypto.randomUUID(), description: q.description ?? "", expect: pretty(q.expect), options: q.options.map(o => ({ ...o, key: crypto.randomUUID(), description: o.description ?? "", setTags: pretty(o.setTags ?? {}), unsetTags: pretty(o.unsetTags ?? []) })) })) };
}
function readJson(value: string, label: string): unknown {
  try { return JSON.parse(value); } catch { throw new SurveyValidationError([`${label}: enter valid JSON`]); }
}
function documentOf(d: Draft): SurveyDocument {
  return parseSurvey({ version: 1, challenge: d.challenge, match: readJson(d.match, "Identity tags"), features: readJson(d.features, "Features"), questions: d.questions.map(q => ({
    id: q.id, prompt: q.prompt, ...(q.description ? { description: q.description } : {}), expect: readJson(q.expect, `Question ${q.id} expected tags`), options: q.options.map(o => {
      const set = readJson(o.setTags, `Option ${o.id} tags to set`);
      const unset = readJson(o.unsetTags, `Option ${o.id} tags to remove`);
      return { id: o.id, label: o.label, ...(o.description ? { description: o.description } : {}), ...(set && typeof set === "object" && Object.keys(set).length === 0 ? {} : { setTags: set }), ...(Array.isArray(unset) && unset.length === 0 ? {} : { unsetTags: unset }) };
    }),
  })) });
}
function download(name: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const errorsOf = (e: unknown) => e instanceof SurveyValidationError ? e.problems : [describeError(e).message];
const SAMPLE_ID = "node/9999999999999999";

export function SurveyBuilder() {
  const storageKey = `survey-draft:${config().backend}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try { const saved = localStorage.getItem(storageKey); if (saved) return draftOf(parseSurvey(JSON.parse(saved))); } catch { /* A damaged/older local draft does not prevent loading a portable file. */ }
    return draftOf(exampleSurvey("restaurant"));
  });
  const [notice, setNotice] = useState("");
  const [actionErrors, setActionErrors] = useState<string[]>([]);
  const [exported, setExported] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationAttempted, setCreationAttempted] = useState(false);
  const [challengeId, setChallengeId] = useState<number>();
  const [importAttempted, setImportAttempted] = useState(false);
  const [report, setReport] = useState<TaskImportReport>();
  const [published, setPublished] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);
  const [projectId, setProjectId] = useState("");
  const result = useMemo(() => {
    try { const survey = documentOf(draft); return { survey, generated: generateTasks(survey), errors: [] as string[] }; }
    catch (e) { return { survey: undefined, generated: undefined, errors: errorsOf(e) }; }
  }, [draft]);
  const snapshot = result.survey ? pretty(result.survey) : "";
  const sampleFeatures = result.survey?.features.features.some(f => f.properties["@id"] === SAMPLE_ID) ?? false;
  const validProjectId = /^[1-9][0-9]*$(?![\s\S])/.test(projectId) && Number.isSafeInteger(Number(projectId));
  const canCreate = validProjectId && !!result.generated?.count && !sampleFeatures && snapshot === exported && !creationAttempted;
  const updateQuestion = (i: number, q: QuestionDraft) => setDraft(d => ({ ...d, questions: d.questions.map((old, j) => j === i ? q : old) }));
  const loadExample = (kind: "restaurant" | "bus-stop") => { setDraft(draftOf(exampleSurvey(kind))); setExported(""); setNotice("Example loaded. Replace the fictional feature before creating a challenge."); setActionErrors([]); };
  async function loadFile(file: File | undefined, featuresOnly: boolean) {
    if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error("File exceeds 10 MiB. Use a smaller feature batch.");
      const parsed: unknown = JSON.parse(await file.text());
      if (featuresOnly) setDraft(d => ({ ...d, features: pretty(parsed) }));
      else setDraft(draftOf(parseSurvey(parsed)));
      setActionErrors([]); setExported(""); setNotice(featuresOnly ? "Feature file loaded. Review the generated tasks below." : "Survey file loaded.");
    } catch (e) { setActionErrors(errorsOf(e)); }
  }
  function save(exportFile: boolean) {
    if (!result.survey) return;
    try {
      if (exportFile) { download("survey.json", `${snapshot}\n`); setExported(snapshot); setNotice("Survey file downloaded. Keep it as the authoring source."); }
      else { localStorage.setItem(storageKey, snapshot); setNotice("Draft saved in this browser for this backend. Export a survey file for a portable copy."); }
      setActionErrors([]);
    } catch (e) { setActionErrors(errorsOf(e)); }
  }
  async function create() {
    if (!canCreate || !result.survey) return;
    setCreationAttempted(true); setBusy(true); setActionErrors([]);
    try { const c = await createSurveyChallenge(result.survey.challenge, Number(projectId)); setChallengeId(c.id); setNotice(`Challenge ${c.id} created as disabled in project ${projectId}. Import the reviewed tasks below.`); }
    catch (e) { setActionErrors([...errorsOf(e), "Creation was attempted. Check Challenges and the audit log before trying again; a lost response can hide a successful creation."]); }
    finally { setBusy(false); }
  }
  async function importTasks() {
    if (!challengeId || !result.generated || importAttempted) return;
    setImportAttempted(true); setBusy(true); setActionErrors([]);
    try { setReport(await importChallengeTasks(challengeId, new File([result.generated.text], "tasks.geojsonl", { type: "application/x-ndjson" }))); setNotice(`Import finished for challenge ${challengeId}.`); }
    catch (e) { setActionErrors([...errorsOf(e), `Import was attempted for challenge ${challengeId}. Check its tasks and audit log before any manual retry. Accepted lines may already exist.`]); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!challengeId || !report || report.rejected.length || report.updated || report.created !== result.generated?.count || publishAttempted) return;
    setPublishAttempted(true); setBusy(true); setActionErrors([]);
    try { await publishSurveyChallenge(challengeId); setPublished(true); setNotice(`Challenge ${challengeId} published for Android discovery. OSM write policy is unchanged.`); }
    catch (e) { setActionErrors([...errorsOf(e), `Publication was attempted. Check challenge ${challengeId} and its audit record before retrying.`]); }
    finally { setBusy(false); }
  }
  return <section className="survey-builder">
    <h2>Survey builder</h2>
    <p>Write the questions once. Supply the places to survey, then review what volunteers will see and what their answers add to the map.</p>
    <p className="hint">Connected to <code>{config().backend}</code>. Creating and importing tasks does not switch on OpenStreetMap edits.</p>
    {notice && <p role="status" className="notice">{notice}</p>}
    {actionErrors.length > 0 && <div role="alert" className="error">{actionErrors.map(e => <p key={e}>{e}</p>)}</div>}
    <div className="survey-toolbar">
      <button type="button" disabled={creationAttempted} onClick={() => loadExample("restaurant")}>Restaurant example</button>
      <button type="button" disabled={creationAttempted} onClick={() => loadExample("bus-stop")}>Bus stop example</button>
      <label>Open survey file<input type="file" accept=".json" disabled={creationAttempted} onChange={e => { void loadFile(e.target.files?.[0], false); e.target.value = ""; }} /></label>
      <button type="button" disabled={!result.survey} onClick={() => save(false)}>Save browser draft</button>
      <button type="button" disabled={!result.survey} onClick={() => save(true)}>Export survey file</button>
    </div>
    <div className="survey-workspace">
      <fieldset className="survey-editor" disabled={creationAttempted}>
        <legend>Survey definition</legend>
        <div className="panel">
          <h3>Challenge</h3>
          {([ ["name", "Title"], ["description", "Description"], ["instruction", "Instructions"], ["checkinComment", "OSM changeset comment"], ["checkinSource", "OSM changeset source"] ] as const).map(([key, label]) => <label key={key}>{label}<textarea aria-label={label} rows={key === "instruction" ? 3 : 2} value={draft.challenge[key]} onChange={e => setDraft(d => ({ ...d, challenge: { ...d.challenge, [key]: e.target.value } }))} /></label>)}
          <label>Identity tags<textarea aria-label="Identity tags" className="tag-input" value={draft.match} onChange={e => setDraft(d => ({ ...d, match: e.target.value }))} /></label>
          <p className="hint">All of these OSM tags must match, for example {`{"amenity":"restaurant"}`}.</p>
        </div>
        {draft.questions.map((q, i) => <div className="panel question-editor" key={q.key}>
          <h3>Question {i + 1}</h3>
          <label>Question ID<input value={q.id} onChange={e => updateQuestion(i, { ...q, id: e.target.value })} /></label>
          <label>Question text<input value={q.prompt} onChange={e => updateQuestion(i, { ...q, prompt: e.target.value })} /></label>
          <label>Question help<textarea aria-label="Question help" value={q.description} onChange={e => updateQuestion(i, { ...q, description: e.target.value })} /></label>
          <label>Expected tags<textarea aria-label="Expected tags" className="tag-input" value={q.expect} onChange={e => updateQuestion(i, { ...q, expect: e.target.value })} /></label>
          <p className="hint">Use null for a missing tag. This question is offered only while these conditions hold.</p>
          {q.options.map((o, oi) => <fieldset className="option-editor" key={o.key}>
            <legend>Answer {oi + 1}</legend>
            {([ ["id", "Answer ID"], ["label", "Answer label"], ["description", "Answer help"], ["setTags", "Tags to set"], ["unsetTags", "Tags to remove"] ] as const).map(([key, label]) => <label key={key}>{label}<textarea aria-label={label} rows={key === "description" ? 2 : 1} className={key === "setTags" || key === "unsetTags" ? "tag-input" : undefined} value={o[key]} onChange={e => updateQuestion(i, { ...q, options: q.options.map((old, j) => j === oi ? { ...old, [key]: e.target.value } : old) })} /></label>)}
            <button type="button" disabled={q.options.length <= 2} onClick={() => updateQuestion(i, { ...q, options: q.options.filter((_, j) => j !== oi) })}>Remove answer {oi + 1}</button>
          </fieldset>)}
          <div className="survey-toolbar"><button type="button" disabled={q.options.length >= 12} onClick={() => updateQuestion(i, { ...q, options: [...q.options, { key: crypto.randomUUID(), id: "", label: "", description: "", setTags: "{}", unsetTags: "[]" }] })}>Add answer</button>
          <button type="button" disabled={draft.questions.length <= 1} onClick={() => setDraft(d => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))}>Remove question {i + 1}</button></div>
        </div>)}
        <button type="button" disabled={draft.questions.length >= 8} onClick={() => setDraft(d => ({ ...d, questions: [...d.questions, { key: crypto.randomUUID(), id: "", prompt: "", description: "", expect: "{}", options: [{ key: crypto.randomUUID(), id: "yes", label: "Yes", description: "", setTags: "{}", unsetTags: "[]" }, { key: crypto.randomUUID(), id: "no", label: "No", description: "", setTags: "{}", unsetTags: "[]" }] }] }))}>Add question</button>
        <div className="panel">
          <h3>Features to survey</h3>
          <label>Open feature file<input type="file" accept=".json,.geojson" onChange={e => { void loadFile(e.target.files?.[0], true); e.target.value = ""; }} /></label>
          <label>FeatureCollection<textarea aria-label="FeatureCollection" rows={12} className="tag-input" value={draft.features} onChange={e => setDraft(d => ({ ...d, features: e.target.value }))} /></label>
          <p className="hint">Each feature needs properties.@id (node/ID, way/ID or relation/ID), its current OSM tags, and a representative Point location in [longitude, latitude] order. Examples are fictional.</p>
        </div>
      </fieldset>
      <aside className="survey-preview" aria-label="Survey preview">
        <h3>Volunteer preview</h3>
        <p>Questions with already-known tags are omitted for each feature.</p>
        <h4>{draft.challenge.name}</h4><p>{draft.challenge.instruction}</p>
        {draft.questions.map((q, i) => <div className="preview-question" key={q.key}>
          <span className="hint">Question {i + 1}</span><h4>{q.prompt || "Your question"}</h4>{q.description && <p>{q.description}</p>}
          {q.options.map(o => <div className="preview-answer" key={o.key}><strong>{o.label || "Answer"}</strong>{o.description && <p>{o.description}</p>}<small>Set <code>{o.setTags}</code> · Remove <code>{o.unsetTags}</code></small></div>)}
          <div className="preview-answer">I can't tell <small>Leaves this question unanswered.</small></div>
        </div>)}
        <p className="hint">Volunteers review answers before saving a public OpenStreetMap edit. Partial answers still close the task.</p>
      </aside>
    </div>
    <div className="panel survey-publish">
      <h3>Review and import</h3>
      {result.errors.length > 0 ? <div role="alert" className="error">{result.errors.map(e => <p key={e}>{e}</p>)}</div> : <>
        <p>{result.generated?.count} tasks ready. {result.generated?.skipped.length} features omitted.</p>
        {result.generated?.skipped.map(s => <p className="hint" key={s}>{s}</p>)}
        {sampleFeatures && <p>Replace the fictional example features before creating a challenge. You can download examples for local testing.</p>}
        <button type="button" disabled={!result.generated?.count} onClick={() => download("tasks.geojsonl", result.generated?.text ?? "", "application/x-ndjson")}>Download generated tasks</button>
        <details><summary>Generated task preview</summary><pre>{result.generated?.text.split("\n").filter(Boolean).slice(0, 3).map(line => pretty(JSON.parse(line))).join("\n")}</pre></details>
      </>}
      {!creationAttempted && <><label>Project ID on this backend<input inputMode="numeric" value={projectId} onChange={e => setProjectId(e.target.value)} /></label><p>Use an enabled project that you can manage. A disabled parent project prevents Android discovery. Project IDs differ between backends.</p><p>Export the current survey file, then create a new challenge. Existing challenges are never overwritten by this builder.</p><button type="button" disabled={!canCreate || busy} onClick={() => void create()}>Create new challenge</button></>}
      {challengeId && <><p>Challenge <strong>{challengeId}</strong> on <code>{config().backend}</code>. Keep this ID with your survey file.</p><button type="button" disabled={busy || importAttempted} onClick={() => void importTasks()}>Import {result.generated?.count} reviewed tasks</button></>}
      {report && <div role="status"><p>Created {report.created}; updated {report.updated}; rejected {report.rejected.length}.</p>{report.rejected.map(r => <p className="error" key={r.line}>Line {r.line}: {r.errors.join("; ")}</p>)}</div>}
      {report && !published && <><p>Publish only after every reviewed task was created successfully. This makes the challenge visible in Android; it does not enable OSM writes.</p><button type="button" disabled={busy || publishAttempted || report.rejected.length > 0 || report.updated > 0 || report.created !== result.generated?.count} onClick={() => void publish()}>Publish for Android</button></>}
      {published && <p>Refresh Challenges in the Android app to find this survey.</p>}
    </div>
  </section>;
}
