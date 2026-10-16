import { expect, test, type Page } from "@playwright/test";
import { MOCK } from "./env";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

test("lists campaigns with where they stand in the app, and filters them", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("link", { name: "Campaigns" })).toHaveAttribute("aria-current", "page");
  const row = (id: number) => page.locator(`tr[data-campaign="${id}"]`);
  await expect(row(3)).toContainText("Street Tally test: 1300 S 900 E bus stops");
  await expect(row(3)).toContainText("Project off");
  await expect(row(3)).toContainText("Hidden: project off");
  await expect(row(3)).toContainText("12 of 28 checked · 2 need another look");
  await expect(row(7)).toContainText("Listed");
  await expect(row(9)).toContainText("Draft");
  await page.locator(".filters label", { hasText: "In the app" }).click();
  await expect(page.locator("tr[data-campaign]")).toHaveCount(1);
  await expect(row(7)).toBeVisible();
  await page.locator(".filters label", { hasText: "Drafts" }).click();
  await expect(page.locator("tr[data-campaign]")).toHaveCount(1);
  await expect(row(9)).toBeVisible();
});

test("a hidden campaign's page turns its project on, and shares and exports", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Street Tally test: 1300 S 900 E bus stops" }).click();
  await expect(page).toHaveURL("/campaigns/3");
  const status = page.locator(".status-line");
  await expect(status).toHaveText(/Hidden from the app: project “SLC test” is off\./);
  await expect(page.locator(".qr-warning")).toHaveText("Hidden from the app. This code won't work until the project is on.");
  await status.getByRole("button", { name: "Turn project on" }).click();
  await page.getByRole("dialog", { name: "Turn on project “SLC test”?" }).getByRole("button", { name: "Turn on" }).click();
  await expect(status).toHaveText("Listed in the app, but task writes are off on DEV: people can open it but can't save yet.");

  await expect(page.locator(".qr-warning")).toHaveCount(0);
  await expect(page.getByText("mrchoice://challenge/3")).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code for mrchoice://challenge/3" })).toBeVisible();
  await expect(page.getByText("Doesn't open the app yet: needs the App Store build.")).toBeVisible();
  await expect(page.getByRole("img", { name: /QR code for https/ })).toHaveCount(0);
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await png).suggestedFilename()).toBe("campaign-3-app-qr.png");
  const csv = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  expect((await csv).suggestedFilename()).toBe("challenge-3-results.csv");
  await expect(page.getByText("Bus stop survey #StreetTally")).toBeVisible();
  const reports = page.locator(".panel", { has: page.getByRole("heading", { name: "Reports" }) });
  await expect(reports).toContainText("No reports yet.");
  await expect(reports.getByLabel("Challenge ID")).toHaveCount(0);
});

test("a draft is published from its page after the checks", async ({ page }) => {
  await signIn(page);
  await page.goto("/campaigns/9");
  const status = page.locator(".status-line");
  await expect(status).toHaveText(/Draft: not in the app yet\./);
  await expect(page.locator(".qr-warning")).toHaveText("Not in the app yet. This code won't work until you publish.");
  await status.getByRole("button", { name: "Publish" }).click();
  const sheet = page.getByRole("dialog", { name: "Publish to the app?" });
  await expect(sheet.locator("[data-check=hashtag]")).toContainText("no #hashtag");
  await expect(sheet.locator("[data-check=description]")).toContainText("link or a time per stop");
  await expect(sheet.locator("[data-check=import]")).toHaveCount(0);
  for (const box of await sheet.getByRole("checkbox").all()) await box.check();
  await sheet.getByRole("button", { name: "Publish to the app" }).click();
  await expect(status).toHaveText("Listed in the app, but task writes are off on DEV: people can open it but can't save yet.");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("/api/v2/challenge/9").first()).toBeVisible();
});

test("a campaign's live page is created, set up, ended and given a new link", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/campaigns/7");
  const live = page.locator(".panel", { has: page.getByRole("heading", { name: "Live page" }) });
  await expect(live).toContainText("No live page yet.");
  await live.getByRole("button", { name: "Create live page" }).click();
  await expect(live.locator(".live-status")).toHaveText("On. The page updates every 30 seconds.");
  const link = live.locator(".share-line code");
  await expect(link).toHaveText(/^https:\/\/streettally\.mr-dev\.osm\.lol\/live\/[A-Za-z0-9_-]{43}$/);
  const first = (await link.textContent())!.split("/live/")[1];
  const pub = (token: string) => request.get(`${MOCK}/api/v2/live/${token}`);
  expect((await (await pub(first)).json()).answersShown).toBe(false);

  await live.getByLabel("Show each place's answers").click();
  await expect(live.getByLabel("Show each place's answers")).toBeChecked();
  expect((await (await pub(first)).json()).answersShown).toBe(true);

  await live.getByLabel("Count people from").fill("2026-10-18T19:00");
  await live.getByRole("button", { name: "Save" }).click();
  await expect(live).toContainText("Counting people who saved a place since Oct 18, 7:00 pm.");
  await live.getByRole("button", { name: "Stop counting" }).click();
  await expect(live.getByRole("button", { name: "Stop counting" })).toHaveCount(0);

  await live.getByLabel("Page on").click();
  await expect(live.locator(".live-status")).toHaveText("Turned off. Anyone with the link sees that the page is turned off.");
  await expect(live.locator(".qr-warning")).toBeVisible();
  expect((await (await pub(first)).json()).error).toBe("turned_off");
  await live.getByLabel("Page on").click();
  await expect(live.getByLabel("Page on")).toBeChecked();

  await live.getByRole("button", { name: "End live mode" }).click();
  await expect(live.locator(".live-status")).toHaveText(/^Ended .+\. The page shows the final tally and no longer updates\.$/);
  expect((await (await pub(first)).json()).mode).toBe("ended");
  await live.getByRole("button", { name: "Make live again" }).click();
  await expect(live.locator(".live-status")).toHaveText("On. The page updates every 30 seconds.");

  await live.getByRole("button", { name: "New link…" }).click();
  await expect(live.getByRole("alert")).toContainText("The current link stops working right away");
  await live.getByRole("button", { name: "Make a new link" }).click();
  await expect(link).not.toHaveText(new RegExp(first));
  expect((await (await pub(first)).json()).error).toBe("not_found");

  await page.reload();
  await expect(live.locator(".live-status")).toHaveText("On. The page updates every 30 seconds.");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("live.rotate")).toBeVisible();
});

test("old addresses and unknown campaigns", async ({ page }) => {
  await signIn(page);
  await page.goto("/surveys");
  await expect(page).toHaveURL("/new");
  await expect(page.getByRole("heading", { name: "New campaign" })).toBeVisible();
  await page.getByText("Advanced: import a task file into an existing challenge").click();
  await expect(page.getByRole("heading", { name: "Challenges" }).first()).toBeVisible();
  await page.goto("/campaigns/12345");
  await expect(page.getByText("No choice campaign 12345 on this backend.")).toBeVisible();
});

test("a campaign's confirm queue is checked and downloaded for maproulette.org", async ({ page }) => {
  await signIn(page);
  await page.goto("/campaigns/7");
  const queue = page.locator(".panel", { has: page.getByRole("heading", { name: "Confirm queue" }) });
  await queue.getByRole("button", { name: "Download for maproulette.org" }).click();
  await expect(queue.locator(".queue-summary")).toHaveText("Nothing in the queue yet. Check the answers first.");

  await queue.getByRole("button", { name: "Check answers and update the queue" }).click();
  await expect(queue.locator(".queue-summary")).toHaveText(
    "2 suggestions added · 1 already on the map · 1 place changed on OSM since the survey · 1 question where people gave different answers.",
  );
  await queue.getByRole("button", { name: "Check answers and update the queue" }).click();
  await expect(queue.locator(".queue-summary")).toHaveText(
    "0 suggestions added · 2 already in the queue · 1 question where people gave different answers.",
  );

  const download = page.waitForEvent("download");
  await queue.getByRole("button", { name: "Download for maproulette.org" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("confirm-queue-7.geojson");
  const lines = (await (await import("node:fs/promises")).readFile((await file.path())!, "utf8")).trim().split("\n");
  expect(lines).toHaveLength(2);
  expect(JSON.parse(lines[0]).cooperativeWork.operations[0].data.id).toBe("node/101");
});
