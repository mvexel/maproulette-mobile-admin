import { useEffect, useMemo, useState } from "react";
import { describeError } from "../api";
import { config } from "../config";
import { navigate } from "../router";
import { type Area, countSets, type OpenFeature, type Place, type QuestionSet, questionSets, type SetCount, type SetFeatures, searchPlaces, setFeatures } from "../wizard/api";
import { WizardMap } from "../wizard/WizardMap";
import {
  bySetCount,
  changesetComment,
  checkLine,
  countLine,
  DEFAULT_RADIUS,
  distance,
  draftDescription,
  draftName,
  eventDay,
  hashtag,
  paceHint,
  pickable,
  RADII,
  RADIUS_MAX,
  RADIUS_MIN,
} from "../wizard/words";

/**
 * New campaign in ten minutes (design/campaign-wizard.md): where, what to check, check the list,
 * words. Publish and share (step 5) follow with the create endpoint.
 */

const STEPS = ["Where", "What to check", "Check the list", "Words", "Publish and share"] as const;
type Step = 1 | 2 | 3 | 4;

interface Words {
  name: string;
  description: string;
  eventDate: string;
}

export function Wizard() {
  const [step, setStep] = useState<Step>(1);
  const [place, setPlace] = useState<Place>();
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [set, setSet] = useState<QuestionSet>();
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());
  const [words, setWords] = useState<Words>();
  // How many features step 3 ended with, for the preview.
  const [openCount, setOpenCount] = useState(0);
  const area = useMemo<Area | undefined>(() => place && { lat: place.lat, lon: place.lon, radius }, [place, radius]);
  const reached: Step = !place ? 1 : !set ? 2 : !words ? 3 : 4;

  // A different area or set means a different list: what was left out no longer applies.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on these changes only
  useEffect(() => setLeftOut(new Set()), [area, set]);

  return (
    <section className="wizard">
      <div className="wizard-head">
        <h2>New campaign</h2>
        <a
          href="/new/advanced"
          onClick={(e) => {
            e.preventDefault();
            navigate("/new/advanced");
          }}
        >
          Advanced: build from a survey file
        </a>
      </div>
      <ol className="stepper">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const can = n <= Math.max(reached, step) && n <= 4;
          return (
            <li key={label} aria-current={n === step ? "step" : undefined} className={n < step ? "done" : undefined}>
              <button type="button" disabled={!can} onClick={() => setStep(n as Step)}>
                <span className="n">{n}</span> {label}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 1 && (
        <Where
          place={place}
          radius={radius}
          onPlace={(p) => {
            setPlace(p);
            setWords(undefined);
          }}
          onRadius={setRadius}
          next={() => setStep(2)}
        />
      )}
      {step === 2 && area && place && (
        <WhatToCheck
          area={area}
          chosen={set}
          onChoose={(s) => {
            setSet(s);
            setWords(undefined);
          }}
          next={() => setStep(3)}
        />
      )}
      {step === 3 && area && set && (
        <CheckList
          area={area}
          set={set}
          leftOut={leftOut}
          onToggle={(id) =>
            setLeftOut((old) => {
              const s = new Set(old);
              if (!s.delete(id)) s.add(id);
              return s;
            })
          }
          back={() => setStep(1)}
          next={(open) => {
            setWords((w) => w ?? { name: draftName(set, place?.name ?? ""), description: draftDescription(set, place?.name ?? ""), eventDate: "" });
            setOpenCount(open);
            setStep(4);
          }}
        />
      )}
      {step === 4 && set && place && words && <WordsStep set={set} place={place.name} words={words} onWords={setWords} open={openCount} />}
    </section>
  );
}

function Where({
  place,
  radius,
  onPlace,
  onRadius,
  next,
}: {
  place?: Place;
  radius: number;
  onPlace: (p: Place) => void;
  onRadius: (m: number) => void;
  next: () => void;
}) {
  const [q, setQ] = useState(place?.name ?? "");
  const [results, setResults] = useState<Place[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const custom = !RADII.some((r) => r.metres === radius);
  const [showCustom, setShowCustom] = useState(custom);
  const style = config().mapStyle;

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const found = await searchPlaces(q.trim());
      setResults(found);
      if (found.length === 1) onPlace(found[0]);
    } catch {
      setError("The place search didn't answer. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="step">
      <form className="search" onSubmit={search}>
        <label htmlFor="where">Where's your event? A place, an address or a neighbourhood</label>
        <div className="row">
          <input id="where" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          <button type="submit" disabled={busy || !q.trim()}>
            {busy ? "Searching…" : "Search"}
          </button>
        </div>
      </form>
      {error && <p className="error">{error}</p>}
      {results && results.length === 0 && <p className="hint">Nothing found. Try a street address or a nearby landmark.</p>}
      {results && results.length > 1 && (
        <ul className="results" aria-label="Places found">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon},${r.label}`}>
              <button type="button" aria-pressed={place?.label === r.label} onClick={() => onPlace(r)}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {place && (
        <>
          <fieldset className="chips">
            <legend>How far around {place.name}?</legend>
            {RADII.map((r) => (
              <button
                key={r.metres}
                type="button"
                aria-pressed={!showCustom && radius === r.metres}
                onClick={() => {
                  setShowCustom(false);
                  onRadius(r.metres);
                }}
              >
                {r.label}
              </button>
            ))}
            <button type="button" aria-pressed={showCustom} onClick={() => setShowCustom(true)}>
              Custom
            </button>
          </fieldset>
          {showCustom && (
            <label className="slider">
              <span>{distance(radius)}</span>
              <input
                type="range"
                min={RADIUS_MIN}
                max={RADIUS_MAX}
                step={100}
                value={radius}
                onChange={(e) => onRadius(Number(e.target.value))}
                aria-label="Distance around the place"
              />
            </label>
          )}
          {style ? (
            <WizardMap style={style} area={{ lat: place.lat, lon: place.lon, radius }} label={`${distance(radius)} around ${place.name}`} />
          ) : (
            <p className="area-line" data-testid="area">
              {distance(radius)} around {place.name}
            </p>
          )}
          <p className="hint">You can change this later.</p>
          <div className="actions">
            <button type="button" className="primary" onClick={next}>
              Next: what to check
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function WhatToCheck({ area, chosen, onChoose, next }: { area: Area; chosen?: QuestionSet; onChoose: (s: QuestionSet) => void; next: () => void }) {
  const [sets, setSets] = useState<QuestionSet[]>();
  const [counts, setCounts] = useState<Map<string, SetCount>>(new Map());
  const [error, setError] = useState<string>();

  useEffect(() => {
    questionSets()
      .then(setSets)
      .catch((e: unknown) => setError(describeError(e).message));
  }, []);
  useEffect(() => {
    let live = true;
    setCounts(new Map());
    countSets(area)
      .then((cs) => live && setCounts(new Map(cs.map((c) => [c.set, c]))))
      .catch((e: unknown) => {
        if (!live) return;
        const rate = e instanceof Error && "code" in e && e.code === "rate_limited";
        setError(rate ? "Too many searches. Try again in a minute." : describeError(e).message);
      });
    return () => {
      live = false;
    };
  }, [area]);

  if (error) return <p className="error">{error}</p>;
  if (!sets) return <p className="hint">Loading the question sets…</p>;
  const ordered = bySetCount(sets, counts);
  const chosenCount = chosen && counts.get(chosen.id);
  const hint = chosen && chosenCount && !("unavailable" in chosenCount) ? paceHint(chosenCount.open, chosen) : undefined;
  return (
    <div className="step">
      <ul className="sets" aria-label="Question sets">
        {ordered.map((s) => {
          const c = counts.get(s.id);
          return (
            <li key={s.id}>
              <button type="button" className="set" aria-pressed={chosen?.id === s.id} disabled={!pickable(c)} onClick={() => onChoose(s)}>
                <span className="name">{s.name}</span>
                <span className="why">{s.why}</span>
                <span className="example">For example: {s.example}</span>
                <span className="set-count">{countLine(c)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {hint && <p className="hint">{hint}</p>}
      <p className="hint">
        Missing something? <a href="mailto:martijn@osm.lol?subject=A%20new%20Street%20Tally%20question%20set">Ask us for a new question set</a>.
      </p>
      <div className="actions">
        <button type="button" className="primary" disabled={!chosen || !pickable(chosen && counts.get(chosen.id))} onClick={next}>
          Next: check the list
        </button>
      </div>
    </div>
  );
}

function CheckList({
  area,
  set,
  leftOut,
  onToggle,
  back,
  next,
}: {
  area: Area;
  set: QuestionSet;
  leftOut: ReadonlySet<string>;
  onToggle: (id: string) => void;
  back: () => void;
  next: (open: number) => void;
}) {
  const [data, setData] = useState<SetFeatures>();
  const [error, setError] = useState<string>();
  const style = config().mapStyle;
  useEffect(() => {
    let live = true;
    setData(undefined);
    setFeatures(set.id, area)
      .then((d) => live && setData(d))
      .catch((e: unknown) => live && setError(describeError(e).message));
    return () => {
      live = false;
    };
  }, [set, area]);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="hint">Finding the {set.noun.many}…</p>;
  const open = data.open.length - data.open.filter((f) => leftOut.has(f.id)).length;
  return (
    <div className="step">
      <p className="check-line" data-testid="check-line">
        {checkLine(open, data.complete, set)}
      </p>
      {data.truncated && <p className="warning">That's more than we can show. Make the area smaller to see them all.</p>}
      <div className="check">
        {style && (
          <WizardMap
            style={style}
            area={area}
            features={data.open}
            leftOut={leftOut}
            onToggle={onToggle}
            label={`${data.open.length} ${set.noun.many} on a map. Tap one to leave it out.`}
          />
        )}
        <ul className="features" aria-label={`${set.noun.many} in the campaign`}>
          {data.open.map((f) => (
            <FeatureRow key={f.id} f={f} set={set} out={leftOut.has(f.id)} onToggle={onToggle} />
          ))}
        </ul>
      </div>
      <p className="hint">
        Leave out anything people can't or shouldn't check, such as private or construction sites.{" "}
        <button type="button" className="link" onClick={back}>
          Make the area smaller or bigger
        </button>
      </p>
      <div className="actions">
        <button type="button" className="primary" disabled={open === 0} onClick={() => next(open)}>
          Next: words
        </button>
      </div>
    </div>
  );
}

function FeatureRow({ f, set, out, onToggle }: { f: OpenFeature; set: QuestionSet; out: boolean; onToggle: (id: string) => void }) {
  const title = f.name ?? `${set.noun.one.charAt(0).toUpperCase()}${set.noun.one.slice(1)} · ${f.id.replace("/", " ")}`;
  return (
    <li className={out ? "out" : undefined}>
      <span>{title}</span>
      <button type="button" onClick={() => onToggle(f.id)} aria-label={`${out ? "Put back" : "Leave out"} ${title}`}>
        {out ? "Put back" : "Leave out"}
      </button>
    </li>
  );
}

function WordsStep({ set, place, words, onWords, open }: { set: QuestionSet; place: string; words: Words; onWords: (w: Words) => void; open: number }) {
  const tag = hashtag(place);
  const comment = changesetComment(words.name, tag);
  return (
    <div className="step words">
      <form className="fields" onSubmit={(e) => e.preventDefault()}>
        <label>
          Name
          <input value={words.name} onChange={(e) => onWords({ ...words, name: e.target.value })} maxLength={120} required />
        </label>
        <label>
          Description
          <textarea value={words.description} onChange={(e) => onWords({ ...words, description: e.target.value })} rows={4} maxLength={600} />
        </label>
        <label>
          Event date (optional)
          <input type="date" value={words.eventDate} onChange={(e) => onWords({ ...words, eventDate: e.target.value })} />
          <span className="hint">Shown on the invite and the table card.</span>
        </label>
        <details>
          <summary>Details for mappers</summary>
          <dl>
            <dt>Hashtag</dt>
            <dd>
              <code>{tag}</code>
            </dd>
            <dt>Changeset comment</dt>
            <dd>
              <code>{comment}</code>
            </dd>
          </dl>
        </details>
        <p className="hint">Publishing and the share panel come next, with the organizer role.</p>
      </form>
      <Preview set={set} words={words} open={open} />
    </div>
  );
}

/** The campaign as a participant sees it in the app's list: a phone frame. */
function Preview({ set, words, open }: { set: QuestionSet; words: Words; open: number }) {
  return (
    <figure className="phone" aria-label="Participant preview">
      <div className="screen">
        <p className="kicker">Street Tally</p>
        <h3>{words.name || "Your campaign"}</h3>
        {words.eventDate && <p className="date">{eventDay(words.eventDate)}</p>}
        <p>{words.description}</p>
        <p className="tally">
          0 of {open} {open === 1 ? set.noun.one : set.noun.many} checked
        </p>
        <span className="cta">Start checking</span>
      </div>
      <figcaption>What participants see</figcaption>
    </figure>
  );
}
