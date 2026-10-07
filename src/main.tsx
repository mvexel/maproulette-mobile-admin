import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadConfig } from "./config";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
loadConfig()
  .then(() => root.render(<StrictMode><App /></StrictMode>))
  .catch((e: Error) => root.render(<p className="error">Cannot load configuration: {e.message}</p>));
