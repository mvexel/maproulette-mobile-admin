import { role } from "../auth";
import { useEffect, useState } from "react";
import { getWritePolicy, onWritePolicyChange } from "../api";
import { config } from "../config";
import { navigate } from "../router";

/** DEV, STAGE or PROD from the config; the backend URL shows on hover. */
export function EnvironmentBadge() {
  const { backend, environment } = config();
  return (
    <span className={`env-badge env-${environment ?? "unknown"}`} data-testid="environment" data-backend={backend}>
      {environment ? environment.toUpperCase() : "UNKNOWN BACKEND"}
      <span className="visually-hidden"> backend: {backend}</span>
    </span>
  );
}

/** Whether task writes are on for this backend; opens Task writes. */
export function WritesPill() {
  const [enabled, setEnabled] = useState<boolean>();
  useEffect(() => {
    let current = true;
    getWritePolicy()
      .then((p) => { if (current) setEnabled(p.enabled); })
      .catch(() => { if (current) setEnabled(undefined); });
    const off = onWritePolicyChange((p) => setEnabled(p.enabled));
    return () => { current = false; off(); };
  }, []);
  if (enabled === undefined) return null;
  // Organizers can't open Task writes: a label for them, in what it means for their campaigns.
  if (role() === "organizer")
    return (
      <span
        className={`writes-pill ${enabled ? "on" : "off"}`}
        data-testid="writes-pill"
        title={enabled ? "The Street Tally team turns publishing on and off." : "You can save drafts. Publishing is turned off for now."}
      >
        {enabled ? "Publishing on" : "Publishing off"}
      </span>
    );
  return (
    <a
      href="/writes"
      className={`writes-pill ${enabled ? "on" : "off"}`}
      data-testid="writes-pill"
      title="Task writes for this backend"
      onClick={(e) => {
        e.preventDefault();
        navigate("/writes");
      }}
    >
      {enabled ? "Writes on" : "Writes off"}
    </a>
  );
}
