import { useEffect, useState } from "react";
import { describeError, getWritePolicy, setWritePolicy, type WritePolicy as Policy } from "../api";
import { config } from "../config";

/** Each admin site controls the policy stored by its own backend. */
export function WritePolicy() {
  const [policy, setPolicy] = useState<Policy>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let current = true;
    getWritePolicy()
      .then((value) => { if (current) setPolicy(value); })
      .catch((reason: unknown) => { if (current) setError(describeError(reason).message); });
    return () => { current = false; };
  }, []);

  async function change(next: boolean) {
    const action = next ? "Enable" : "Disable";
    if (!window.confirm(`${action} mobile task writes and OSM edits on ${config().backend}?`)) return;
    setSaving(true);
    setError(undefined);
    try {
      setPolicy(await setWritePolicy(next));
    } catch (reason) {
      setError(describeError(reason).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <h2>Mobile task writes</h2>
      <p>Backend: <strong>{config().backend}</strong></p>
      <p>This switch controls mobile task lifecycle submissions and choice submissions,
        including edits sent to OpenStreetMap. It applies to this backend only and is recorded in the audit log.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {policy === undefined ? <p>Loading…</p> : (
        <div className="panel">
          <p>Status: <strong>{policy.enabled ? "Enabled" : "Disabled"}</strong></p>
          {policy.managed ? (
            <button type="button" disabled={saving} onClick={() => void change(!policy.enabled)}>
              {policy.enabled ? "Disable writes" : "Enable writes"}
            </button>
          ) : <p>This deployment manages task writes through its server configuration.</p>}
        </div>
      )}
    </section>
  );
}
