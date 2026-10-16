import base from "./playwright.config.ts";
export default { ...base, projects: [{ name: "chromium", use: { ...(base.projects?.[0]?.use ?? {}), launchOptions: { executablePath: "/opt/pw-browsers/chromium" } } }] };
