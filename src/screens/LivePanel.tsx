import { useEffect, useState } from "react";
import { getLivePage, type LivePage, type LivePageChange, rotateLivePage, updateLivePage } from "../api";
import { fromLocalInput, liveLink, toLocalInput } from "../campaigns";
import { shortDateTime } from "../format";
import { ErrorMessage } from "./ErrorMessage";
import { ShareLine } from "./Share";

function status(p: LivePage): string {
  if (!p.enabled) return "Turned off. The link says the page is turned off.";
  if (p.endedAt) return `Ended ${shortDateTime(p.endedAt)}. The page shows the final tally and no longer updates.`;
  return "On. The page updates every 30 seconds.";
}

/**
 * The campaign's live progress page (BACKLOG #12): create it, turn it on or off, show answers,
 * count people from an event start, end live mode, and replace the link.
 */
export function LivePanel({ challenge }: { challenge: number }) {
  // undefined while loading, null when the campaign has no page yet.
  const [page, setPage] = useState<LivePage | null>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState("");
  const [rotating, setRotating] = useState(false);

  const shown = (p: LivePage | undefined) => {
    setPage(p ?? null);
    setStart(p?.eventStart ? toLocalInput(p.eventStart) : "");
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per campaign.
  useEffect(() => {
    getLivePage(challenge).then(shown, setError);
  }, [challenge]);

  async function run(work: () => Promise<LivePage>) {
    setError(undefined);
    setBusy(true);
    try {
      shown(await work());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  const change = (c: LivePageChange) => run(() => updateLivePage(challenge, c));
  const startIso = fromLocalInput(start);

  return (
    <div className="panel live-panel">
      <h3>Live page</h3>
      <p className="hint">
        A page for a projector or a group chat: the tally and a map of what's checked. Anyone with the link can see it. It never shows who checked
        what.
      </p>
      <ErrorMessage error={error} />
      {page === undefined && !error && <p>Loading live page…</p>}
      {page === null && (
        <p>
          No live page yet.{" "}
          <button type="button" className="primary" disabled={busy} onClick={() => void change({})}>
            Create live page
          </button>
        </p>
      )}
      {page && (
        <>
          <p className="live-status" role="status">
            {status(page)}
          </p>
          <ShareLine
            label="Live page link"
            url={liveLink(page.token)}
            file={`campaign-${challenge}-live-qr.png`}
            warning={page.enabled ? undefined : "Turned off. This code shows “This page is turned off” until you turn it on."}
          />
          <div className="live-settings">
            <label>
              <input type="checkbox" checked={page.enabled} disabled={busy} onChange={(e) => void change({ enabled: e.target.checked })} /> Page on
            </label>
            <label>
              <input type="checkbox" checked={page.showAnswers} disabled={busy} onChange={(e) => void change({ showAnswers: e.target.checked })} />{" "}
              Show each place's answers
              <span className="hint"> The answers only, never who gave them. Answers saved without an account stay hidden until they're on OpenStreetMap.</span>
            </label>
            <form
              className="live-start"
              onSubmit={(e) => {
                e.preventDefault();
                if (startIso) void change({ eventStart: startIso });
              }}
            >
              <label>
                Count people from <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>{" "}
              <button type="submit" disabled={busy || !startIso || startIso === page.eventStart}>
                Save
              </button>{" "}
              {page.eventStart && (
                <button type="button" disabled={busy} onClick={() => void change({ eventStart: null })}>
                  Stop counting
                </button>
              )}
              <p className="hint">
                {page.eventStart
                  ? `Counting people who saved a place since ${shortDateTime(page.eventStart)}. A number only, no names.`
                  : "Shows how many people saved a place since this time. A number only, no names."}
              </p>
            </form>
            <p>
              {page.endedAt ? (
                <button type="button" disabled={busy} onClick={() => void change({ ended: false })}>
                  Make live again
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void change({ ended: true })}>
                  End live mode
                </button>
              )}{" "}
              {!rotating && (
                <button type="button" disabled={busy} onClick={() => setRotating(true)}>
                  New link…
                </button>
              )}
            </p>
            {rotating && (
              <p className="live-rotate" role="alert">
                The current link stops working right away, for everyone who has it.{" "}
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setRotating(false);
                    void run(() => rotateLivePage(challenge));
                  }}
                >
                  Make a new link
                </button>{" "}
                <button type="button" onClick={() => setRotating(false)}>
                  Cancel
                </button>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
