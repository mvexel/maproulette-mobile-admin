import { expect, type Page, test } from "@playwright/test";
import { MOCK } from "./env";

/** The campaign wizard (design/campaign-wizard.md), against the mock's endpoints. Without a map style: lists. */

async function openWizard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await page.getByRole("link", { name: "New campaign" }).click();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
  // Publishing is refused while saving is off (backend #47's rule); a draft saves anyway (W-DRAFT, backend #60).
  expect((await request.post(`${MOCK}/__mock/write-policy?enabled=true`)).status()).toBe(204);
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
  // A super-user runs both projects, so step 1 asks which one.
  await expect(page.getByRole("button", { name: "Next: what to check" })).toBeDisabled();
  await page.getByLabel("Which project is it for?").selectOption({ label: "Street Tally pilots" });
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
  // Unnamed features go by where they are, not by their OSM id.
  await expect(list.getByRole("listitem").nth(1)).toContainText("Entrance, 200 m northwest");
  await list.getByRole("button", { name: "Leave out Entrance, 200 m northwest" }).click();
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
    "From a Street Tally survey for Library doors, 10 November 2026. Checked by me. #StreetTally #StreetTallySaltLakeCityLibrary",
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

test("saves a draft, survives a changed question set, publishes and shares", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openWizard(page);
  await expect(page.getByRole("link", { name: "Nominatim" })).toHaveAttribute("href", "https://nominatim.org/");
  await page.getByLabel("Where's your event? A place, an address or a neighbourhood").fill("woodbine");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Which project is it for?").selectOption({ label: "Street Tally pilots" });
  await page.getByRole("button", { name: "Next: what to check" }).click();
  await page.getByRole("list", { name: "Question sets" }).getByRole("button", { name: /^Entrance doors/ }).click();
  await page.getByRole("button", { name: "Next: check the list" }).click();
  await page.getByRole("button", { name: "Next: words" }).click();
  await page.getByLabel("Name").fill("Woodbine entrance doors");
  await page.getByLabel("Event date (optional)").fill("2026-11-10");

  // The first save finds the set moved on: back to step 2, words kept.
  let first = true;
  await page.route(`${MOCK}/api/v2/mobile-admin/wizard/campaigns`, async (route) => {
    if (!first) return route.fallback();
    first = false;
    await route.fulfill({
      status: 409,
      json: { error: "set_changed", detail: ["entrance-doors is at version 4"] },
      headers: { "Access-Control-Allow-Origin": "http://localhost:4173" },
    });
  });
  await page.getByRole("button", { name: "Next: save and share" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "The Entrance doors questions changed while you were working. Pick a set again to get the updated list. Your words are kept.",
  );
  await page.getByRole("list", { name: "Question sets" }).getByRole("button", { name: /^Entrance doors/ }).click();
  await page.getByRole("button", { name: "Next: check the list" }).click();
  await page.getByRole("list", { name: "entrances in the campaign" }).getByRole("button", { name: "Leave out Entrance 1", exact: true }).click();
  await page.getByRole("button", { name: "Next: words" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Woodbine entrance doors");

  const create = page.waitForRequest((r) => r.url().endsWith("/api/v2/mobile-admin/wizard/campaigns") && r.method() === "POST");
  await page.getByRole("button", { name: "Next: save and share" }).click();
  expect((await create).postDataJSON()).toMatchObject({
    projectId: 2,
    set: "entrance-doors",
    version: 3,
    area: { radius: 800, place: "Woodbine Food Hall" },
    leaveOut: ["node/9100"],
    name: "Woodbine entrance doors",
    eventDate: "2026-11-10",
  });

  // Step 5: the draft, then publish and the share panel. Earlier steps are closed.
  await expect(page.locator(".saved-line")).toHaveText("Saved as a draft with 22 entrances. It isn't in the app until you publish.");
  await expect(page.getByRole("button", { name: /Words/ })).toBeDisabled();
  await expect(page.getByRole("img", { name: "QR code for https://streettally.mr-dev.osm.lol/challenge/101?preview=1" })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Your campaign is live. Anyone with the link can join.");
  await expect(page.getByRole("img", { name: "QR code for https://streettally.mr-dev.osm.lol/challenge/101" }).first()).toBeVisible();
  await expect(page.getByLabel("Invite to paste")).toHaveValue(
    "Join us at Woodbine Food Hall on 10 November 2026 to check entrances for Street Tally. No account needed, just your phone: https://streettally.mr-dev.osm.lol/challenge/101",
  );
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PNG" }).click();
  expect((await png).suggestedFilename()).toBe("campaign-101-qr.png");
  const card = page.getByRole("article", { name: "Table card preview" });
  await expect(card.getByRole("heading")).toHaveText("Woodbine entrance doors");
  await expect(card).toContainText("Check the entrances");
  await expect(card.locator("footer")).toHaveText("10 November 2026 · Woodbine Food Hall#StreetTallyWoodbineFoodHall");
  await page.screenshot({ path: "test-results/wizard-share.png", fullPage: true });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: "test-results/wizard-card-print.png" });
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("link", { name: "Open the campaign page" }).click();
  await expect(page).toHaveURL("/campaigns/101");
  await expect(page.locator(".status-line")).toContainText("Listed in the app");
});

test("an organizer starts the wizard from Campaigns and the campaign lands in their project", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-organizer/ }).click();
  await expect(page).toHaveURL(/scope=mobile%3Aorganize/);
  await page.getByRole("link", { name: /Sign in as mock-organizer/ }).click();
  await page.getByRole("button", { name: "New campaign" }).click();
  await expect(page).toHaveURL("/new");
  await page.getByLabel("Where's your event? A place, an address or a neighbourhood").fill("woodbine");
  await page.getByRole("button", { name: "Search" }).click();
  // One project: picked for them, no question.
  await expect(page.getByLabel("Which project is it for?")).toHaveCount(0);
  await page.getByRole("button", { name: "Next: what to check" }).click();
  await page.getByRole("list", { name: "Question sets" }).getByRole("button", { name: /^Crossings/ }).click();
  await page.getByRole("button", { name: "Next: check the list" }).click();
  await page.getByRole("button", { name: "Next: words" }).click();
  await page.getByRole("button", { name: "Next: save and share" }).click();
  // Publishing off: an organizer gets a way to ask the team.
  await request.post(`${MOCK}/__mock/write-policy?enabled=false`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Your draft is saved, but publishing is off on this server right now. Ask the Street Tally team to turn it on, then publish.");
  await expect(page.getByRole("alert").getByRole("link", { name: "Ask the Street Tally team" })).toHaveAttribute("href", /^mailto:martijn@osm\.lol/);
  await request.post(`${MOCK}/__mock/write-policy?enabled=true`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Your campaign is live. Anyone with the link can join.");
  await page.getByRole("link", { name: "Open the campaign page" }).click();
  await expect(page).toHaveURL("/campaigns/101");
  await expect(page.getByRole("heading", { level: 2, name: /^Crossings around Woodbine Food Hall/ })).toBeVisible();
});

test("saves a draft while writing is off, refuses only the publish, and offers to turn an off project on after publishing", async ({ page, request }) => {
  await openWizard(page);
  await page.getByLabel("Where's your event? A place, an address or a neighbourhood").fill("woodbine");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByLabel("Which project is it for?").selectOption({ label: "SLC test" });
  await page.getByRole("button", { name: "Next: what to check" }).click();
  await page.getByRole("list", { name: "Question sets" }).getByRole("button", { name: /^Bus stops/ }).click();
  await page.getByRole("button", { name: "Next: check the list" }).click();
  await page.getByRole("button", { name: "Next: words" }).click();

  await request.post(`${MOCK}/__mock/write-policy?enabled=false`);
  await page.getByRole("button", { name: "Next: save and share" }).click();
  await expect(page.getByText(/^Saved as a draft with/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the campaign page" })).toHaveAttribute("href", "/campaigns/101");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Your draft is saved, but publishing is off on this server right now. Turn it on under Task writes, then publish.");
  await request.post(`${MOCK}/__mock/write-policy?enabled=true`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  const status = page.getByRole("status").first();
  await expect(status).toHaveText("Published, but the project “SLC test” is off, so the campaign isn't in the app yet. Turn project on");
  await status.getByRole("button", { name: "Turn project on" }).click();
  await page.getByRole("dialog", { name: "Turn on project “SLC test”?" }).getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("status").first()).toHaveText("Your campaign is live. Anyone with the link can join.");
});
