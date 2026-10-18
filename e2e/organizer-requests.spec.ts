import { expect, type Page, test } from "@playwright/test";
import { MOCK } from "./env.ts";

/** ORG-ONB (design/organizer-onboarding.md §2): asking to run campaigns, and the super-user's answer. */

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

/** Signs in through every scope the account needs: admin, then organize, then organizer-request. */
async function signIn(page: Page, as: string, scopes: number) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  for (let i = 0; i < scopes; i++) {
    await expect(page).toHaveURL(/127\.0\.0\.1:9300\/oauth\/mobile\/authorize\?/);
    await page.getByRole("link", { name: new RegExp(`Sign in as ${as}`) }).click();
  }
  await expect(page).not.toHaveURL(/9300/);
}

async function noSidewaysScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

for (const width of [1280, 390]) {
  test(`asks to run campaigns, and shows the request was sent (${width} px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, "mock-mapper", 3);
    await expect(page).toHaveURL(/\/callback$|\/$/);
    await expect(page.getByRole("heading", { name: "Run a campaign with Street Tally" })).toBeVisible();
    await expect(page.getByTestId("ask-username")).toHaveText("mock-mapper");
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await noSidewaysScroll(page);

    const send = page.getByRole("button", { name: "Ask to run campaigns" });
    await page.getByLabel("Where will it happen?").fill("Woodbine, Toronto");
    await page.getByLabel("What will people check?").fill("Entrances and crossings");
    // Criterion 8: the policy box gates the button, and its link opens the OSM wiki page.
    await expect(send).toBeDisabled();
    await expect(page.getByRole("link", { name: "organised editing guidelines" })).toHaveAttribute(
      "href",
      "https://wiki.openstreetmap.org/wiki/Organised_Editing_Guidelines",
    );
    await page.getByLabel("I'll follow OpenStreetMap's organised editing guidelines").check();
    await expect(send).toBeEnabled();
    await page.screenshot({ path: `test-results/org-onb/request-form-${width}.png`, fullPage: true });
    await send.click();

    await expect(page.getByRole("heading", { name: "We've got your request" })).toBeVisible();
    await expect(page.getByText("The Street Tally team looks at each request by hand. Sign in here again to see if you're set up.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Questions? Email martijn@osm.lol" })).toHaveAttribute(
      "href",
      "mailto:martijn@osm.lol?subject=Street%20Tally%20organizer",
    );
    await noSidewaysScroll(page);
    await page.screenshot({ path: `test-results/org-onb/request-sent-${width}.png`, fullPage: true });

    // The next visit shows the same.
    await page.reload();
    await expect(page.getByRole("heading", { name: "We've got your request" })).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in with OpenStreetMap" })).toBeVisible();
  });

  test(`shows a decline with its note (${width} px)`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, "mock-mapper", 3);
    await page.getByLabel("Where will it happen?").fill("Woodbine, Toronto");
    await page.getByLabel("What will people check?").fill("Entrances and crossings");
    await page.getByLabel("I'll follow OpenStreetMap's organised editing guidelines").check();
    await page.getByRole("button", { name: "Ask to run campaigns" }).click();
    await expect(page.getByRole("heading", { name: "We've got your request" })).toBeVisible();
    await request.post(`${MOCK}/__mock/organizer-requests/user/8/decline?note=${encodeURIComponent("We're only running Utah campaigns this year.")}`);
    await page.reload();
    await expect(page.getByRole("heading", { name: "We can't set you up right now." })).toBeVisible();
    await expect(page.getByText("We're only running Utah campaigns this year.")).toBeVisible();
    await expect(page.getByText(/You can ask again on/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Questions? Email martijn@osm.lol" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask to run campaigns" })).toHaveCount(0);
    await noSidewaysScroll(page);
    await page.screenshot({ path: `test-results/org-onb/declined-${width}.png`, fullPage: true });
  });

  test(`lands an approved organizer on Campaigns with a one-time note (${width} px)`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    await request.post(`${MOCK}/__mock/organizer-requests/user/11/approve?projectName=Sugar%20House`);
    await signIn(page, "rosa_slc", 2);
    await expect(page).toHaveURL("/");
    const note = page.getByRole("status").filter({ hasText: "You're set up. Start your first campaign." });
    await expect(note).toBeVisible();
    await noSidewaysScroll(page);
    await page.screenshot({ path: `test-results/org-onb/approved-${width}.png`, fullPage: true });
    await note.getByRole("button", { name: "New campaign" }).click();
    await expect(page.getByRole("heading", { name: "New campaign" })).toBeVisible();
    // One time only.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Campaigns/ })).toBeVisible();
    await expect(page.getByText("You're set up. Start your first campaign.")).toHaveCount(0);
  });
}

test("lets a super-user approve with an editable project name, or decline with a note", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // A second open request, from mock-mapper.
  await signIn(page, "mock-mapper", 3);
  await page.getByLabel("Where will it happen?").fill("Woodbine, Toronto");
  await page.getByLabel("What will people check?").fill("Entrances and crossings");
  await page.getByLabel("I'll follow OpenStreetMap's organised editing guidelines").check();
  await page.getByRole("button", { name: "Ask to run campaigns" }).click();
  await expect(page.getByRole("heading", { name: "We've got your request" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();

  await signIn(page, "mock-superuser", 1);
  const nav = page.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Organizers (2)" })).toBeVisible();
  await nav.getByRole("link", { name: "Organizers (2)" }).click();
  const rosa = page.getByTestId("request-1");
  await expect(rosa).toContainText("rosa_slc");
  await expect(rosa).toContainText("3 edits");
  await expect(rosa).toContainText("Sugar House, Salt Lake City");
  await expect(rosa).toContainText("Benches and bus shelters");
  await expect(rosa).toContainText("Sugar House Community Council");
  await expect(rosa.getByRole("link", { name: "rosa_slc" })).toHaveAttribute("href", /\/user\/rosa_slc$/);
  await page.screenshot({ path: "test-results/org-onb/requests-1280.png", fullPage: true });

  // Approve: the project name starts as their place; a taken name is refused.
  await rosa.getByRole("button", { name: "Approve" }).click();
  await expect(rosa.getByLabel("Project name")).toHaveValue("Sugar House, Salt Lake City");
  await rosa.getByLabel("Project name").fill("Street Tally pilots");
  await rosa.getByRole("button", { name: "Approve and make the project" }).click();
  await expect(page.getByRole("alert")).toHaveText("There's already a project with that name. Change the name and approve again.");
  await rosa.getByLabel("Project name").fill("Sugar House");
  await rosa.getByRole("button", { name: "Approve and make the project" }).click();
  await expect(page.getByRole("status")).toHaveText("rosa_slc can now run campaigns in Sugar House.");
  await expect(page.getByTestId("organizer-11")).toContainText("Sugar House (write)");
  await expect(nav.getByRole("link", { name: "Organizers (1)" })).toBeVisible();

  // Decline with a note.
  const mapper = page.locator("[data-testid^=request-]");
  await expect(mapper).toHaveCount(1);
  await mapper.getByRole("button", { name: "Decline" }).click();
  await mapper.getByLabel(/Note to them/).fill("We're only running Utah campaigns this year.");
  await mapper.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("status")).toHaveText("Declined mock-mapper's request.");
  await expect(page.getByRole("heading", { name: "Requests" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Organizers", exact: true })).toBeVisible();
});

test("fits the Requests section at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await signIn(page, "mock-superuser", 1);
  await page.getByRole("link", { name: "Organizers (1)" }).click();
  await page.getByTestId("request-1").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByLabel("Project name")).toBeVisible();
  await noSidewaysScroll(page);
  await page.screenshot({ path: "test-results/org-onb/requests-390.png", fullPage: true });
});
