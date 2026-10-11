import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config";
import "./claim.css";

// Pasting another emailed link into the same tab only changes the fragment: start over with it.
window.addEventListener("hashchange", () => location.reload());

const root = createRoot(document.getElementById("root")!);
loadConfig().then(
  () =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  () => root.render(<p className="boot-error">This page isn't set up yet (config.json is missing or invalid).</p>),
);
