import { expect, test } from "@playwright/test";
import { MOCK_LIVE_TOKENS as L } from "../mock/server.ts";
import { CLAIM, MOCK } from "./env.ts";

/** The review page for local mappers (handback-copy §2, SPRINT 3 H2). Without a map style: the list. */

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

test("shows the evidence per place, with no Accept and nothing that uploads", async ({ page }) => {
  await page.goto(`${CLAIM}/review/${L.live}`);
  await expect(page).toHaveTitle("Review · Woodbine entrance doors · Street Tally");
  await expect(page.locator("#counts")).toHaveText("3 answers to review · 1 added · 1 needs a visit");
  await expect(page.locator(".place")).toHaveCount(5);

  const granary = page.getByRole("article", { name: "Granary Live" });
  await expect(granary.locator(".evidence li")).toHaveText([
    "Slides sideways door=sliding2 people, 14 Oct · On OSM now: not set",
    "Yes, when you walk up automatic_door=motion2 people, 14 Oct · On OSM now: not set",
  ]);
  await expect(granary.locator(".actions > *")).toHaveText(["Open in JOSM", "Open in iD", "Skip", "Needs a visit"]);
  await expect(granary.getByRole("link", { name: "Open in iD" })).toHaveAttribute("href", /\/edit\?editor=id&node=9001$/);
  await expect(page.getByRole("button", { name: /accept|upload|publish/i })).toHaveCount(0);

  await expect(page.getByRole("article", { name: "Entrance B" }).locator(".report")).toHaveText("There's no door · 1 person, 14 Oct");
  const moved = page.locator(".place").nth(2);
  await expect(moved.locator(".chip")).toHaveText("Needs a look");
  await expect(moved.locator(".report")).toHaveText("It's moved · 1 person, 14 Oct");
  const hall = page.getByRole("article", { name: "Woodbine Food Hall" });
  await expect(hall.locator(".chip")).toHaveText("On the map");
  await expect(hall.getByRole("button", { name: "Skip" })).toHaveCount(0);

  await expect(page.locator("#comment")).toHaveText(
    "From a Street Tally survey for Woodbine entrance doors, 13 Oct to 14 Oct. Checked by me. #StreetTally #StreetTallyWoodbine",
  );
  await page.screenshot({ path: "test-results/review-page.png", fullPage: true });

  await page.getByRole("button", { name: "2 people agree" }).click();
  await expect(page.locator(".place h2")).toHaveText(["Granary Live"]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".place h2")).toHaveText(["Woodbine Food Hall"]);
  await page.getByRole("button", { name: "Needs a visit", exact: true }).first().click();
  await expect(page.locator(".place")).toHaveCount(1);
});

test("signs in read-only, skips for you only and marks a visit", async ({ page }) => {
  await page.goto(`${CLAIM}/review/${L.live}`);
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:9300\/oauth\/mobile\/authorize\?.*client_id=street-tally-review/);
  await page.getByRole("link", { name: /Sign in as mock-mapper/ }).click();
  await expect(page.getByText("Signed in as mock-mapper")).toBeVisible();
  // Back on the page's own link, without the code in the address bar.
  expect(new URL(page.url()).pathname).toBe(`/review/${L.live}`);
  expect(new URL(page.url()).search).toBe("");

  await page.getByRole("article", { name: "Granary Live" }).getByRole("button", { name: "Skip" }).click();
  await expect(page.getByRole("article", { name: "Granary Live" })).toHaveCount(0);
  await expect(page.locator("#skipped")).toHaveText("You skipped 1 place. Show them");
  await page.getByRole("button", { name: "Show them" }).click();
  await page.getByRole("article", { name: "Granary Live" }).getByRole("button", { name: "Undo skip" }).click();
  await expect(page.locator("#skipped")).toBeHidden();

  await page.getByRole("article", { name: "Entrance B" }).getByRole("button", { name: "Needs a visit" }).click();
  await expect(page.getByRole("article", { name: "Entrance B" }).locator(".chip")).toHaveText("Needs a visit");
  await expect(page.locator("#counts")).toHaveText("2 answers to review · 1 added · 2 need a visit");
});

test("a turned-off page and a bad link each say so", async ({ page }) => {
  await page.goto(`${CLAIM}/review/${L.off}`);
  await expect(page.getByRole("heading", { name: "This page is turned off" })).toBeVisible();
  await page.goto(`${CLAIM}/review/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
});
