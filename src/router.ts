import { useEffect, useState } from "react";

/** The current path; re-renders on navigate() and history changes. */
export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const h = () => setPath(location.pathname);
    addEventListener("popstate", h);
    return () => removeEventListener("popstate", h);
  }, []);
  return path;
}

/** Client-side navigation. `replace` keeps the current entry (and its URL) out of history. */
export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}
