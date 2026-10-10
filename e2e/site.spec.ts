import { devices, expect, test } from "@playwright/test";
import { CLAIM as SITE } from "./env.ts";

/** The participant site's static pages: the campaign landing page, the root page and the AASA file. */

test.describe("on an iPhone", () => {
  test.use({ userAgent: devices["iPhone 15"].userAgent });

  test("shows the campaign and links to install and open it", async ({ page }) => {
    await page.goto(`${SITE}/challenge/7`);
    await expect(page.getByRole("heading", { name: "Join SLC Bus Stops" })).toBeVisible();
    await expect(page.getByText(/Help check every bus stop in Salt Lake City/)).toBeVisible();
    await expect(page).toHaveTitle("Join SLC Bus Stops on Street Tally");
    await expect(page.getByRole("link", { name: "Install the beta" })).toHaveAttribute(
      "href",
      "https://testflight.apple.com/join/TEST1234",
    );
    await expect(page.getByRole("link", { name: "Open the campaign" })).toHaveAttribute("href", "mrchoice://challenge/7");
    await expect(page.getByText("You don't need an account to take part.")).toBeVisible();
  });

  test("falls back to generic text when the campaign can't be read", async ({ page }) => {
    await page.goto(`${SITE}/challenge/99`);
    await expect(page.getByRole("link", { name: "Open the campaign" })).toHaveAttribute("href", "mrchoice://challenge/99");
    await expect(page.getByRole("heading", { name: "Join this campaign" })).toBeVisible();
  });

  test("says so for a malformed campaign link", async ({ page }) => {
    await page.goto(`${SITE}/challenge/not-a-number`);
    await expect(page.getByRole("heading", { name: "We can't find this campaign" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open the campaign" })).toBeHidden();
  });
});

test("asks for an iPhone on other devices", async ({ page }) => {
  await page.goto(`${SITE}/challenge/7`);
  await expect(page.getByRole("heading", { name: "Open this on an iPhone" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Install the beta" })).toBeHidden();
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
