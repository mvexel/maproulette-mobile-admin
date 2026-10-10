import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { MOCK_CLAIM_TOKENS as T } from "../mock/server.ts";
import { CLAIM, MOCK } from "./env.ts";

/** The participant claim page (deferred-signup-ux.md §3, deferred-signup-api.md §3.7 and §3.10). */

const stats = async (request: APIRequestContext) =>
  (await (await request.get(`${MOCK}/__mock/stats`)).json()) as { authorizationCodes: number; revokes: number };

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

async function signIn(page: Page) {
  await page.getByRole("button", { name: "Sign in to OpenStreetMap" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:9300\/oauth\/mobile\/authorize\?/);
  await page.getByRole("link", { name: /Sign in as mock-mapper/ }).click();
}

test("puts answers on the map and explains the ones that weren't added", async ({ page, request }) => {
  await page.goto(`${CLAIM}/claim#t=${T.partial}`);
  await expect(page.getByRole("heading", { name: "You checked 4 places" })).toBeVisible();
  await page.getByText("Show the list").click();
  await expect(page.locator(".stops li")).toHaveCount(4);

  await signIn(page);
  await expect(page.getByRole("heading", { name: "Ready to put 4 places on the map?" })).toBeVisible();
  // The authorization code doesn't stay in the address bar or history.
  expect(new URL(page.url()).pathname).toBe("/claim");
  expect(new URL(page.url()).search).toBe("");
  await expect(page.getByText("Signed in as mock-mapper")).toBeVisible();

  // "Not now" goes back to the answers with a reassurance, and signing in is still one click away.
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText(/No problem\. Your answers stay saved until/)).toBeVisible();
  await expect(page.getByRole("link", { name: "#StreetTallySLCStops · About this campaign" })).toBeVisible();
  await signIn(page);

  await page.getByRole("button", { name: "Put them on the map" }).click();
  await expect(page.getByRole("heading", { name: "2 places are on the map" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("2 places weren't added")).toBeVisible();
  await page.getByText("Show which").click();
  await expect(page.getByText("It changed on the map since you were there")).toBeVisible();
  await expect(page.getByText("Someone else checked it first")).toBeVisible();
  await expect(page.getByText(/One answer for .+ wasn't added because the map already had it/)).toBeVisible();
  await expect(page.getByRole("link", { name: "See your edits on OpenStreetMap" })).toHaveAttribute(
    "href",
    /\/user\/mock-mapper\/history$/,
  );

  // The page revokes its own grant once the claim is finished.
  await expect.poll(async () => (await stats(request)).revokes).toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { name: /These answers are already on the map/ })).toBeVisible();
});

test("says so when sign-in was cancelled", async ({ page }) => {
  await page.goto(`${CLAIM}/claim#t=${T.all}`);
  await page.getByRole("button", { name: "Sign in to OpenStreetMap" }).click();
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Sign-in didn't finish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("tells the participant to come back while writes are paused", async ({ page, request }) => {
  await request.post(`${MOCK}/__mock/claim-writes?enabled=false`);
  await page.goto(`${CLAIM}/claim#t=${T.all}`);
  await expect(page.getByRole("heading", { name: "You checked 3 places" })).toBeVisible();
  await expect(page.getByText("We can't put answers on the map right this minute")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in to OpenStreetMap" })).toHaveCount(0);
});

test("explains links that are finished, expired, deleted or unknown", async ({ page }) => {
  await page.goto(`${CLAIM}/claim#t=${T.claimed}`);
  await expect(page.getByRole("heading", { name: /These answers are already on the map/ })).toBeVisible();
  await page.goto(`${CLAIM}/claim#t=${T.expired}`);
  await expect(page.getByRole("heading", { name: /This link expired on/ })).toBeVisible();
  await page.goto(`${CLAIM}/claim#t=${T.deleted}`);
  await expect(page.getByRole("heading", { name: "These answers were deleted at your request" })).toBeVisible();
  await page.goto(`${CLAIM}/claim#t=${"z".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "We can't find this link" })).toBeVisible();
  await page.goto(`${CLAIM}/claim/delete`);
  await expect(page.getByRole("heading", { name: "We can't find this link" })).toBeVisible();
});

test("deletes the participant's data from the delete link", async ({ page }) => {
  await page.goto(`${CLAIM}/claim/delete#t=${T.partial}`);
  await expect(page.getByRole("heading", { name: "Delete my data" })).toBeVisible();
  await page.getByRole("button", { name: "Delete my data" }).click();
  await expect(page.getByText("We've deleted your email address and saved answers.")).toBeVisible();
  await page.goto(`${CLAIM}/claim#t=${T.partial}`);
  await expect(page.getByRole("heading", { name: "These answers were deleted at your request" })).toBeVisible();
});

test("stops reminders and keeps the answers", async ({ page }) => {
  await page.goto(`${CLAIM}/claim/stop-reminders#t=${T.all}`);
  await expect(page.getByRole("heading", { name: "Stop reminder emails?" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Keep reminders" })).toBeVisible();
  await page.getByRole("button", { name: "Stop reminders" }).click();
  await expect(page.getByText(/No more reminders\. Your answers are saved until/)).toBeVisible();
  await page.goto(`${CLAIM}/claim#t=${T.all}`);
  await expect(page.getByRole("heading", { name: "You checked 3 places" })).toBeVisible();
});
