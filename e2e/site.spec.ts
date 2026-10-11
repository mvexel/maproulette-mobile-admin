import { devices, expect, test } from "@playwright/test";
import { CLAIM as SITE } from "./env.ts";

for (const [platform, userAgent] of [["iPhone", devices["iPhone 15"].userAgent], ["Android", devices["Pixel 7"].userAgent], ["desktop", devices["Desktop Chrome"].userAgent]]) {
  test(`installation and same campaign return on ${platform}`, async ({ page }) => {
    await page.setExtraHTTPHeaders({ "User-Agent": userAgent });
    await page.goto(`${SITE}/challenge/7`);
    await expect(page.getByRole("heading", { name: "SLC Bus Stops" })).toBeVisible();
    await expect(page).toHaveTitle("SLC Bus Stops · Street Tally");
    await expect(page.getByText(/Help check every bus stop in Salt Lake City/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Join the iPhone pilot" })).toHaveAttribute("href", "https://testflight.apple.com/join/TEST1234");
    await expect(page.getByRole("link", { name: "Download for Android" })).toHaveAttribute("href", "https://downloads.example.test/street-tally.apk");
    await expect(page.getByText("Street Tally pilot — test-1.0")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toHaveAttribute("href", "mrchoice://challenge/7");
    await expect(page.getByText(/Your answers are saved first/)).toBeVisible();
  });
}

test("unavailable links remain truthful; installed app can still open campaign", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { backend: "http://127.0.0.1:9300" } }));
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByText(/iPhone pilot invitation isn't available/)).toBeVisible();
  await expect(page.getByText(/Android download isn't available/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the iPhone pilot" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Download for Android" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toHaveAttribute("href", "mrchoice://challenge/7");
});

test("unsafe download URLs and an APK with no version are not offered", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { backend: "http://127.0.0.1:9300", installUrl: "javascript:alert(1)", androidInstallUrl: "https://downloads.example.test/app.apk" } }));
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByText(/Android download isn't available/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the iPhone pilot" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Download for Android" })).toBeHidden();
});

test("config outage has retry and no placeholder installation or campaign action", async ({ page }) => {
  let fail = true;
  await page.route("**/config.json", (route) => fail ? route.fulfill({ status: 503 }) : route.continue());
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByRole("status")).toContainText("couldn't load the campaign settings");
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toBeHidden();
  await expect(page.getByRole("link", { name: "Join the iPhone pilot" })).toBeHidden();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "SLC Bus Stops" })).toBeVisible();
});

test("campaign outage is retryable without claiming the campaign is missing", async ({ page }) => {
  let fail = true;
  await page.route("**/api/v2/challenge/7", (route) => fail ? route.fulfill({ status: 503 }) : route.continue());
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByRole("status")).toContainText("couldn't load this campaign");
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toBeHidden();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toHaveAttribute("href", "mrchoice://challenge/7");
});

test("unknown campaign gets an explicit missing state", async ({ page }) => {
  await page.goto(`${SITE}/challenge/99`);
  await expect(page.getByRole("status")).toContainText("can't find this campaign");
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toBeHidden();
});

for (const id of ["not-a-number", "0"]) {
  test(`malformed campaign ${id} offers no install or return action`, async ({ page }) => {
    await page.goto(`${SITE}/challenge/${id}`);
    await expect(page.getByRole("status")).toContainText("isn't valid");
    await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Try again" })).toBeHidden();
  });
}

test("narrow light/dark page and large text remain readable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(`${SITE}/challenge/7`);
    await expect(page.getByRole("heading", { name: "SLC Bus Stops" })).toBeVisible();
    await page.screenshot({ path: `/tmp/c001-entry-${colorScheme}.png`, fullPage: true });
  }
  await page.addStyleTag({ content: "body { font-size: 34px; } h1 { font-size: 68px; } h2 { font-size: 40px; } .btn { font-size: 34px; } .note, .step p { font-size: 30px; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toBeVisible();
  await page.screenshot({ path: "/tmp/c001-entry-large-text.png", fullPage: true });
});

test("has a root page", async ({ page }) => {
  await page.goto(`${SITE}/`);
  await expect(page.getByRole("heading", { name: "Count what's on your street" })).toBeVisible();
});

test("serves the apple-app-site-association file as JSON", async ({ request }) => {
  const res = await request.get(`${SITE}/.well-known/apple-app-site-association`);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(await res.json()).toEqual({
    applinks: { details: [{ appIDs: ["ABCDE12345.lol.osm.streettally"], components: [{ "/": "/challenge/*" }] }] },
  });
});

test("has a privacy page", async ({ page }) => {
  await page.goto(`${SITE}/privacy`);
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delete your data" })).toBeVisible();
});
