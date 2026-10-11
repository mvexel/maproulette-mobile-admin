import { devices, expect, test } from "@playwright/test";
import { CLAIM as SITE } from "./env.ts";

for (const [platform, userAgent, first, collapsed] of [
  ["iPhone", devices["iPhone 15"].userAgent, "ios", "android"],
  ["Android", devices["Pixel 7"].userAgent, "android", "ios"],
  ["desktop", devices["Desktop Chrome"].userAgent, "ios", undefined],
] as const) {
  test(`installation and same campaign return on ${platform}`, async ({ browser }) => {
    const context = await browser.newContext({ userAgent });
    const page = await context.newPage();
    await page.goto(`${SITE}/challenge/7`);
    await expect(page.getByRole("heading", { name: "SLC Bus Stops" })).toBeVisible();
    await expect(page).toHaveTitle("SLC Bus Stops · Street Tally");
    await expect(page.getByText(/Help check every bus stop in Salt Lake City/)).toBeVisible();
    await expect(page.locator("#install-ios")).toHaveAttribute("href", "https://testflight.apple.com/join/TEST1234");
    await expect(page.locator("#install-android")).toHaveAttribute("href", "https://downloads.example.test/street-tally.apk");
    await expect(page.locator("#android-version")).toHaveText("Street Tally pilot, version test-1.0");
    await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toHaveAttribute("href", "mrchoice://challenge/7");
    await expect(page.getByText(/No account needed to start/)).toBeVisible();
    // The loaded page shows no status text; the status region stays for errors.
    await expect(page.locator("#status-text")).toHaveText("");
    expect(await page.locator("#open").evaluate((open, first) => {
      const platforms = [...document.querySelectorAll("details.platform")].map((d) => d.id);
      return platforms[0] === first && platforms.every((p) => !!(open.compareDocumentPosition(document.getElementById(p) as Node) & Node.DOCUMENT_POSITION_FOLLOWING));
    }, first)).toBe(true);
    await expect(page.locator(`#${first}`)).toHaveAttribute("open", "");
    if (collapsed) {
      await expect(page.locator(`#${collapsed}`)).not.toHaveAttribute("open", "");
      await page.locator(`#${collapsed} summary`).click();
      await expect(page.locator(`#${collapsed}`)).toHaveAttribute("open", "");
    } else {
      await expect(page.locator("#android")).toHaveAttribute("open", "");
    }
    await context.close();
  });
}

test("unavailable links remain truthful; installed app can still open campaign", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { backend: "http://127.0.0.1:9300" } }));
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByText(/iPhone invitation isn't ready/)).toBeVisible();
  await expect(page.getByText(/Android download isn't ready/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Join the iPhone pilot" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Download for Android" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Get TestFlight" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Install the download" })).toBeHidden();
  await expect(page.locator("#ios-steps")).toBeHidden();
  await expect(page.locator("#android-steps")).toBeHidden();
  await expect(page.getByRole("link", { name: "Open this campaign", exact: true })).toHaveAttribute("href", "mrchoice://challenge/7");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/c001-entry-unavailable.png", fullPage: true });
});

test("one unavailable platform doesn't hide the other platform's available steps", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { backend: "http://127.0.0.1:9300", androidInstallUrl: "https://downloads.example.test/app.apk", androidVersion: "test-2.0" } }));
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByText(/iPhone invitation isn't ready/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Get TestFlight" })).toBeHidden();
  await expect(page.getByRole("link", { name: "Download for Android" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Install the download" })).toBeVisible();
  await expect(page.getByText(/Android download isn't ready/)).toBeHidden();
});

test("unsafe download URLs and an APK with no version are not offered", async ({ page }) => {
  await page.route("**/config.json", (route) => route.fulfill({ json: { backend: "http://127.0.0.1:9300", installUrl: "javascript:alert(1)", androidInstallUrl: "https://downloads.example.test/app.apk" } }));
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByText(/Android download isn't ready/)).toBeVisible();
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
