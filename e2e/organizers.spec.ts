import { type Browser, expect, type Page, test } from "@playwright/test";
import { MOCK } from "./env";

/** The organizer role (backend #47): sign-in with mobile:organize, the trimmed admin, and the super-user's Organizers screen. */

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

async function signInSuper(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
}

async function signInOrganizer(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-organizer/ }).click();
  // Refused mobile:admin, the app asks again for mobile:organize. On OpenStreetMap this second
  // round trip needs no clicks; the mock asks again.
  await expect(page).toHaveURL(/scope=mobile%3Aorganize/);
  await page.getByRole("link", { name: /Sign in as mock-organizer/ }).click();
  await expect(page.getByRole("heading", { name: "Campaigns" })).toBeVisible();
}

const nav = (page: Page) => page.locator("header nav a");

test("an organizer sees only their projects' campaigns and no super-user screens", async ({ page }) => {
  await signInOrganizer(page);
  await expect(nav(page)).toHaveText(["Campaigns", "New campaign"]);
  await expect(page.locator(".role-badge")).toHaveText("Organizer");
  await page.screenshot({ path: "test-results/organizer-campaigns.png", fullPage: true });
  await expect(page.getByTestId("user")).toHaveText("mock-organizer");
  // A label, not a link to Task writes.
  await expect(page.getByTestId("writes-pill")).toHaveText("Writes off");
  await expect(page.getByRole("link", { name: "Writes off" })).toHaveCount(0);

  // "Street Tally pilots" only: campaigns 7 and 9, not 3 (SLC test).
  await expect(page.locator("tr[data-campaign]")).toHaveCount(2);
  await expect(page.locator('tr[data-campaign="3"]')).toHaveCount(0);
  await page.getByRole("link", { name: "SLC Bus Stops" }).click();
  await expect(page).toHaveURL("/campaigns/7");
  const live = page.locator(".panel", { has: page.getByRole("heading", { name: "Live page" }) });
  await live.getByRole("button", { name: "Create live page" }).click();
  await expect(live.locator(".live-status")).toHaveText("On. The page updates every 30 seconds.");

  await page.goto("/campaigns/3");
  await expect(page.getByText("No campaign 3 in the projects you organize.")).toBeVisible();
  await page.goto("/clients");
  await expect(page.getByText("This page is for super-users. Your campaigns are under Campaigns.")).toBeVisible();

  await page.goto("/new");
  const picker = page.getByRole("combobox", { name: /^Project/ });
  await expect(picker.locator("option")).toHaveText(["Pick a project", "Street Tally pilots"]);
  await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
  await expect(page.getByText("Advanced: enter a project ID")).toHaveCount(0);
});

test("a super-user adds and removes organizers and their projects", async ({ page }) => {
  await signInSuper(page);
  await page.getByRole("link", { name: "Organizers" }).click();
  await expect(page).toHaveURL("/organizers");
  const row = (id: number) => page.locator(`tr[data-organizer="${id}"]`);
  await expect(row(9)).toContainText("mock-organizer");
  await expect(row(9)).toContainText("Street Tally pilots Write");

  const form = page.getByRole("form", { name: "Add an organizer" });
  await form.getByLabel("OpenStreetMap username").fill("nobody here");
  await form.getByRole("combobox", { name: "Project" }).selectOption({ label: "SLC test" });
  await form.getByRole("button", { name: "Add organizer" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "No MapRoulette account has that OpenStreetMap username. They need to sign in to MapRoulette once first.",
  );

  await form.getByLabel("OpenStreetMap username").fill("dana example");
  await form.getByLabel("Also manages the project (Admin)").check();
  await form.getByRole("button", { name: "Add organizer" }).click();
  await expect(page.getByRole("status")).toHaveText("Added Dana Example to SLC test.");
  await expect(row(10)).toContainText("SLC test Admin");
  await page.screenshot({ path: "test-results/organizers.png", fullPage: true });

  await row(9).getByRole("button", { name: "Remove mock-organizer from Street Tally pilots" }).click();
  await expect(page.getByRole("status")).toHaveText("mock-organizer no longer runs Street Tally pilots.");
  await expect(row(9)).toContainText("No projects: they can sign in but see no campaigns.");

  await row(10).getByRole("button", { name: "Remove organizer" }).click();
  await page.getByRole("dialog", { name: "Remove Dana Example?" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status")).toHaveText("Removed Dana Example. They can no longer sign in here.");
  await expect(row(10)).toHaveCount(0);

  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("organizer.remove")).toBeVisible();
  await expect(page.getByText("organizer.add")).toBeVisible();
});

test("removing an organizer takes effect on their next request", async ({ page, browser }) => {
  await signInOrganizer(page);
  await removeAsSuper(browser, 9);
  await page.getByRole("link", { name: "New campaign" }).click();
  await page.getByRole("link", { name: "Campaigns" }).click();
  await expect(page.getByText("You're no longer an organizer on this server. Sign out and ask us to add you again.")).toBeVisible();
});

async function removeAsSuper(browser: Browser, userId: number) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInSuper(page);
  await page.getByRole("link", { name: "Organizers" }).click();
  await page.locator(`tr[data-organizer="${userId}"]`).getByRole("button", { name: "Remove organizer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("status")).toContainText("They can no longer sign in here.");
  await context.close();
}
