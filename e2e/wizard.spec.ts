import { expect, type Page, test } from "@playwright/test";
import { MOCK } from "./env";

/** The campaign wizard, steps 1–4 (design/campaign-wizard.md), against the mock's endpoints. Without a map style: lists. */

async function openWizard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await page.getByRole("link", { name: "New campaign" }).click();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

test("goes from a place to drafted words with no tags or files", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWizard(page);
  await expect(page.getByRole("heading", { name: "New campaign" })).toBeVisible();
  await expect(page.getByRole("button", { name: /What to check/ })).toBeDisabled();

  // Step 1: search, pick, radius.
  await page.getByLabel("Where's your event? A place, an address or a neighbourhood").fill("salt lake");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("list", { name: "Places found" }).getByRole("button", { name: /^Salt Lake City Library/ }).click();
  await expect(page.getByTestId("area")).toHaveText("800 m around Salt Lake City Library");
  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByLabel("Distance around the place").fill("1600");
  await expect(page.getByTestId("area")).toHaveText("1.6 km around Salt Lake City Library");
  await page.getByRole("button", { name: "5 min walk" }).click();
  await expect(page.getByTestId("area")).toHaveText("400 m around Salt Lake City Library");
  await page.getByRole("button", { name: "10 min" }).click();
  await expect(page.getByText("You can change this later.")).toBeVisible();
  await page.getByRole("button", { name: "Next: what to check" }).click();

  // Step 2: cards sorted by count; nothing to check is disabled; a timed-out count can still be picked.
  const cards = page.getByRole("list", { name: "Question sets" }).getByRole("button");
  await expect(cards.locator(".set-count")).toHaveText(["23 to check here", "14 to check here", "6 to check here", "Count not available", "Nothing to check here"]);
  await expect(cards.locator(".name")).toHaveText(["Entrance doors", "Crossings", "Bus stops", "Trees", "Benches"]);
  await expect(cards.nth(4)).toBeDisabled();
  await expect(cards.nth(3)).toBeEnabled();
  await expect(page.getByText("For example: How does this door open?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next: check the list" })).toBeDisabled();
  await cards.nth(0).click();
  await page.getByRole("button", { name: "Next: check the list" }).click();

  // Step 3: the list, with leave-out.
  await expect(page.getByTestId("check-line")).toHaveText("23 entrances to check. 41 are already complete, so we left them out.");
  const list = page.getByRole("list", { name: "entrances in the campaign" });
  await expect(list.getByRole("listitem")).toHaveCount(23);
  await list.getByRole("button", { name: "Leave out Entrance 1", exact: true }).click();
  await expect(page.getByTestId("check-line")).toHaveText("22 entrances to check. 41 are already complete, so we left them out.");
  await list.getByRole("button", { name: "Leave out Entrance · node 9101" }).click();
  await list.getByRole("button", { name: "Put back Entrance 1", exact: true }).click();
  await expect(page.getByTestId("check-line")).toHaveText("22 entrances to check. 41 are already complete, so we left them out.");
  await page.getByRole("button", { name: "Next: words" }).click();

  // Step 4: drafted words, the hashtag and the phone preview.
  await expect(page.getByLabel("Name")).toHaveValue("Entrance doors around Salt Lake City Library");
  await expect(page.getByLabel("Description")).toHaveValue(
    "Help map the entrances around Salt Lake City Library, so wheelchair, stroller and walker users know what to expect.",
  );
  const phone = page.getByRole("figure", { name: "Participant preview" });
  await expect(phone.locator(".tally")).toHaveText("0 of 22 entrances checked");
  await page.getByLabel("Event date (optional)").fill("2026-11-10");
  await expect(phone.locator(".date")).toHaveText("10 November 2026");
  await page.getByLabel("Name").fill("Library doors");
  await expect(phone.getByRole("heading")).toHaveText("Library doors");
  await page.getByText("Details for mappers").click();
  await expect(page.locator("dd code").first()).toHaveText("#StreetTallySaltLakeCityLibrary");
  await expect(page.locator("dd code").nth(1)).toHaveText(
    "From a Street Tally survey for Library doors. Checked by me. #StreetTally #StreetTallySaltLakeCityLibrary",
  );
  await expect(page.getByRole("button", { name: /Publish and share/ })).toBeDisabled();
  await page.screenshot({ path: "test-results/wizard-words.png", fullPage: true });

  // Back to step 1: a new area resets what was left out, but the edited words stay.
  await page.getByRole("button", { name: /Where/ }).click();
  await page.getByRole("button", { name: "15 min" }).click();
  await page.getByRole("button", { name: /Check the list/ }).click();
  await expect(page.getByTestId("check-line")).toHaveText("52 entrances to check. 92 are already complete, so we left them out.");
});

test("says when a search finds nothing, and keeps the old builder one click away", async ({ page }) => {
  await openWizard(page);
  await page.getByLabel("Where's your event? A place, an address or a neighbourhood").fill("nowhere at all");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Nothing found. Try a street address or a nearby landmark.")).toBeVisible();
  await page.getByLabel("Where's your event? A place, an address or a neighbourhood").fill("woodbine");
  await page.getByRole("button", { name: "Search" }).click();
  // One result is picked straight away.
  await expect(page.getByTestId("area")).toHaveText("800 m around Woodbine Food Hall");
  await page.getByRole("link", { name: "Advanced: build from a survey file" }).click();
  await expect(page).toHaveURL("/new/advanced");
  await expect(page.getByRole("button", { name: "Export survey file" })).toBeVisible();
});
