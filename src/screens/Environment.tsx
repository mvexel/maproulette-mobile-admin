import { useEffect, useState } from "react";
import { getWritePolicy, onWritePolicyChange } from "../api";
import { config } from "../config";
import { navigate } from "../router";

/** DEV, STAGE or PROD from the config; the backend URL is in the tooltip. */
export function EnvironmentBadge() {
  const { backend, environment } = config();
  return (
    <span className={`env-badge env-${environment ?? "unknown"}`} data-testid="environment" title={backend}>
      {environment ? environment.toUpperCase() : "UNKNOWN BACKEND"}
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
