import { expect, test } from "@playwright/test";
import { MOCK_LIVE_TOKENS as L } from "../mock/server.ts";
import { CLAIM } from "./env.ts";

/** The live progress page (BACKLOG #12, design/live-progress.md). Without a map style: the list. */

test("shows the tally, the stops and a stop's answers on a live page", async ({ page }) => {
  await page.goto(`${CLAIM}/live/${L.live}`);
  await expect(page).toHaveTitle("Woodbine entrances · Street Tally");
  await expect(page.locator("#tally .big")).toHaveText("The tally: 3 of 5 entrances checked");
  await expect(page.locator("#sub")).toHaveText("1 needs another look · 1 person tonight");
  await expect(page.locator("#fresh")).toContainText("Live · updated");
  await expect(page.locator("#legendJust")).toBeVisible();
  await expect(page.locator("#footer")).toContainText(
    "This map shows which entrances volunteers checked for Woodbine entrances. It doesn't show who checked them.",
  );
  await expect(page.locator("#footer")).toContainText("#StreetTallyWoodbine");
  await expect(page.locator("#list li")).toHaveCount(5);

  await page.getByRole("button", { name: "Granary Live: Checked" }).click();
  const card = page.getByRole("dialog", { name: "Granary Live" });
  await expect(card).toContainText("Checked in the last 15 min");
  await expect(card.locator("dt")).toHaveText(["How does this door open?", "Does it open by itself?"]);
  await expect(card.locator("dd")).toHaveText(["Slides sideways", "Yes, when you walk up"]);
  await page.screenshot({ path: "test-results/live-page.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();

  await page.getByRole("button", { name: "Entrance B: Checked" }).click();
  await expect(page.getByRole("dialog", { name: "Entrance B" })).toContainText("Reported: Not an entrance");
  await page.getByRole("button", { name: "Entrance: Needs another look" }).click();
  await expect(page.getByRole("dialog", { name: "Entrance" })).toContainText("Someone couldn't check it 20 min ago");
  await expect(page.getByRole("dialog", { name: "Entrance" })).toContainText("Reported: There's no door");
});

test("an ended page shows the date and no live parts", async ({ page }) => {
  await page.goto(`${CLAIM}/live/${L.ended}`);
  await expect(page.locator("#sub")).toHaveText(/^Surveyed \d+ \w+ \d{4} · 1 needs another look$/);
  await expect(page.locator("#fresh")).toBeHidden();
  await expect(page.locator("#legendJust")).toBeHidden();
  await page.getByRole("button", { name: "Granary Live: Checked" }).click();
  await expect(page.getByRole("dialog", { name: "Granary Live" })).toContainText(/Checked on \d+ \w+/);
});

test("a turned-off page and a bad link each say so", async ({ page }) => {
  await page.goto(`${CLAIM}/live/${L.off}`);
  await expect(page.getByRole("heading", { name: "This page is turned off" })).toBeVisible();
  await expect(page.locator("#header")).toBeHidden();
  await page.goto(`${CLAIM}/live/${"x".repeat(43)}`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
  await page.goto(`${CLAIM}/live/short`);
  await expect(page.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();
});

test("fits a phone without sideways scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${CLAIM}/live/${L.live}`);
  await expect(page.locator("#tally .big")).toHaveText("The tally: 3 of 5 entrances checked");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/live-page-phone.png", fullPage: true });
});
