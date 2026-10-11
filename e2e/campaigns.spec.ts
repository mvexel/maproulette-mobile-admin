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
  await status.getByRole("button", { name: "Turn project on" }).click();
  await page.getByRole("dialog", { name: "Turn on project “SLC test”?" }).getByRole("button", { name: "Turn on" }).click();
  await expect(status).toHaveText("Listed in the app. Task writes are off for this backend.");

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
});

test("a draft is published from its page after the checks", async ({ page }) => {
  await signIn(page);
  await page.goto("/campaigns/9");
  const status = page.locator(".status-line");
  await expect(status).toHaveText(/Draft: not in the app yet\./);
  await status.getByRole("button", { name: "Publish" }).click();
  const sheet = page.getByRole("dialog", { name: "Publish to the app?" });
  await expect(sheet.locator("[data-check=hashtag]")).toContainText("no #hashtag");
  await expect(sheet.locator("[data-check=description]")).toContainText("link or a time per stop");
  await expect(sheet.locator("[data-check=import]")).toHaveCount(0);
  for (const box of await sheet.getByRole("checkbox").all()) await box.check();
  await sheet.getByRole("button", { name: "Publish to the app" }).click();
  await expect(status).toHaveText("Listed in the app. Task writes are off for this backend.");
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("/api/v2/challenge/9").first()).toBeVisible();
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
