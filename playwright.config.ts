import { defineConfig, devices } from "@playwright/test";
import { APP, CLAIM, MOCK } from "./e2e/env.ts";

/** End-to-end tests: the built apps (vite preview) against the mock backend. No other network. */
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
      env: { MOCK_PORT: "9300", MOCK_ADMIN_ORIGIN: APP, MOCK_CLAIM_ORIGIN: CLAIM },
      url: `${MOCK}/__mock/stats`,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "npx vite build && npx vite preview --port 4173 --strictPort",
      env: { ADMIN_BACKEND: MOCK },
      url: APP,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Its own output folder, so it doesn't race the admin build, which empties dist/.
      command:
        "npx vite build -c vite.claim.config.ts --outDir ../dist-e2e-claim && npx vite preview -c vite.claim.config.ts --outDir ../dist-e2e-claim --port 4174 --strictPort",
      env: { CLAIM_BACKEND: MOCK },
      url: `${CLAIM}/claim/`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
