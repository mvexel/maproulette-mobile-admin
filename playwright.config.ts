import { defineConfig, devices } from "@playwright/test";
import { APP, MOCK, PORTS } from "./e2e/env.ts";

/** End-to-end tests: the built app (vite preview) against the mock backend. No other network. */
export default defineConfig({
  testDir: "e2e",
  // The tests share one mock backend and reset it before each test.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: APP, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node mock/server.ts",
      env: { MOCK_PORT: PORTS.mock, MOCK_ADMIN_ORIGIN: APP },
      url: `${MOCK}/__mock/stats`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite build && npx vite preview --port ${PORTS.app} --strictPort`,
      env: { ADMIN_BACKEND: MOCK, ADMIN_JOBS: MOCK, ADMIN_JOBS_POLL_MS: "300" },
      url: APP,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
