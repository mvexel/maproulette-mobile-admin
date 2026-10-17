import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { exampleSurvey, generateTasks } from "../src/survey";
import { MOCK } from "./env";

async function openBuilder(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await page.getByRole("link", { name: "New campaign" }).click();
  await page.getByRole("link", { name: "Advanced: build from a survey file" }).click();
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

test("restaurant editor previews questions, saves a draft, and exports a portable definition", async ({ page }) => {
  await openBuilder(page);
  const preview = page.getByRole("complementary", { name: "Survey preview" });
  await expect(preview).toContainText("Is outdoor seating available?");
  await expect(preview).toContainText("Can you order food to take away?");
  await expect(page.getByRole("button", { name: "Create new challenge" })).toBeDisabled();
  await expect(page.getByText("Create is off: replace the fictional example features first.")).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Neighborhood restaurants");
  await page.getByRole("button", { name: "Save browser draft" }).click();
  await page.reload();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Neighborhood restaurants");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export survey file" }).click();
  const downloaded = await pending;
  const file = await downloaded.path();
  expect(file).toBeTruthy();
  if (!file) throw new Error("Missing download");
  const saved = JSON.parse(readFileSync(file, "utf8"));
  expect(saved.version).toBe(1);
  expect(saved.challenge.name).toBe("Neighborhood restaurants");
  expect(saved.questions.map((q: { id: string }) => q.id)).toEqual(["outdoor-seating", "takeaway", "delivery", "toilets"]);
  await page.screenshot({ path: "test-results/survey-builder-desktop.png", fullPage: true });
});

test("creates disabled, imports reviewed existing-contract tasks, then publishes for mobile", async ({ page }) => {
  const survey = exampleSurvey("restaurant");
  survey.challenge.checkinSource = "local knowledge";
  survey.features.features[0].properties["@id"] = "node/123";
  let creates = 0; let imports = 0; let publishes = 0;
  await page.route(`${MOCK}/api/v2/challenge`, async route => {
    creates++;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ ...survey.challenge, parent: 1, enabled: false, requiresLocal: true });
    await route.fulfill({ status: 201, json: { id: 42 }, headers: { "Access-Control-Allow-Origin": "http://localhost:4173" } });
  });
  await page.route(`${MOCK}/api/v2/challenge/42/addFileTasks?lineByLine=true&report=true`, async route => {
    imports++;
    expect(route.request().method()).toBe("PUT");
    expect(route.request().postData()).toContain(generateTasks(survey).text);
    await route.fulfill({ json: { created: 1, updated: 0, rejected: [] }, headers: { "Access-Control-Allow-Origin": "http://localhost:4173" } });
  });
  await page.route(`${MOCK}/api/v2/challenge/42`, async route => {
    publishes++;
    expect(route.request().postDataJSON()).toEqual({ enabled: true, tags: ["mobile-survey-v1"] });
    await route.fulfill({ json: { id: 42, enabled: true }, headers: { "Access-Control-Allow-Origin": "http://localhost:4173" } });
  });
  await openBuilder(page);
  await page.getByLabel("Open survey file").setInputFiles({ name: "survey.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(survey)) });
  await expect(page.getByRole("button", { name: "Create new challenge" })).toBeDisabled();
  const exported = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export survey file" }).click(); await exported;
  await page.getByRole("combobox", { name: /^Project/ }).selectOption({ label: "SLC test (off: its campaigns are hidden in the app)" });
  await expect(page.getByRole("status").filter({ hasText: "Project “SLC test” is off" })).toBeVisible();
  await page.getByRole("button", { name: "Create new challenge" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Import 1 reviewed tasks" }).click();
  await expect(page.getByText("Created 1; updated 0; rejected 0.")).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Publish to the app?" });
  await expect(sheet.locator("[data-check=import]")).toContainText("The reviewed task was created.");
  await expect(sheet.locator("[data-check=project]")).toContainText("Project “SLC test” is off.");
  await expect(sheet.locator("[data-check=writes]")).toContainText("Task writes are off on DEV");
  const go = sheet.getByRole("button", { name: "Publish to the app" });
  await expect(go).toBeDisabled();
  await sheet.getByRole("button", { name: "Turn on project" }).click();
  const toggle = page.getByRole("dialog", { name: "Turn on project “SLC test”?" });
  await expect(toggle).toContainText("Its 1 published campaign will show in the app on DEV. Task writes are unchanged.");
  await toggle.getByRole("button", { name: "Turn on" }).click();
  await expect(sheet.locator("[data-check=project]")).toContainText("Project “SLC test” is on.");
  await expect(go).toBeDisabled();
  await sheet.getByRole("checkbox", { name: /Source is “local knowledge”/ }).check();
  await go.click();
  await expect(page.getByText("Refresh the campaign list in the mobile app to find this survey.")).toBeVisible();
  expect([creates, imports, publishes]).toEqual([1, 1, 1]);
});

test("unknown import outcome blocks retries and publication", async ({ page }) => {
  const survey = exampleSurvey("bus-stop"); survey.features.features[0].properties["@id"] = "way/456";
  let imports = 0;
  await page.route(`${MOCK}/api/v2/challenge`, route => route.fulfill({ status: 201, json: { id: 42 } }));
  await page.route(`${MOCK}/api/v2/challenge/42/addFileTasks?lineByLine=true&report=true`, route => { imports++; return route.abort("failed"); });
  await openBuilder(page);
  await page.getByLabel("Open survey file").setInputFiles({ name: "survey.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(survey)) });
  const exported = page.waitForEvent("download"); await page.getByRole("button", { name: "Export survey file" }).click(); await exported;
  await page.getByRole("combobox", { name: /^Project/ }).selectOption({ label: "Street Tally pilots" });
  await page.getByRole("button", { name: "Create new challenge" }).click();
  await page.getByRole("button", { name: "Import 1 reviewed tasks" }).click();
  await expect(page.getByRole("alert")).toContainText("Accepted lines may already exist");
  await expect(page.getByRole("button", { name: "Import 1 reviewed tasks" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toHaveCount(0);
  expect(imports).toBe(1);
});

test("a partially rejected import cannot be published", async ({ page }) => {
  const survey = exampleSurvey("restaurant"); survey.features.features[0].properties["@id"] = "node/123";
  await page.route(`${MOCK}/api/v2/challenge`, route => route.fulfill({ status: 201, json: { id: 42 } }));
  await page.route(`${MOCK}/api/v2/challenge/42/addFileTasks?lineByLine=true&report=true`, route => route.fulfill({ json: { created: 0, updated: 0, rejected: [{ line: 1, errors: ["Feature rejected"] }] } }));
  await openBuilder(page);
  await page.getByLabel("Open survey file").setInputFiles({ name: "survey.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(survey)) });
  const create = page.getByRole("button", { name: "Create new challenge" });
  await expect(create).toHaveAccessibleDescription("Create is off: export the survey file first, so you keep a copy of what you create.");
  const exported = page.waitForEvent("download"); await page.getByRole("button", { name: "Export survey file" }).click(); await exported;
  await expect(create).toHaveAccessibleDescription("Create is off: pick a project.");
  await page.getByRole("combobox", { name: /^Project/ }).selectOption({ label: "Street Tally pilots" });
  await expect(page.locator("#create-blocker")).toHaveCount(0);
  await create.click();
  await page.getByRole("button", { name: "Import 1 reviewed tasks" }).click();
  await expect(page.getByText("Line 1: Feature rejected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
});

test("mobile preview remains usable and invalid guards cannot be imported", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBuilder(page);
  await page.getByLabel("Expected tags").first().fill('{"takeaway": null}');
  await expect(page.getByRole("alert")).toContainText("not guarded");
  await expect(page.getByRole("button", { name: "Create new challenge" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/survey-builder-mobile.png", fullPage: true });
});

test("the project picker creates a project and accepts a raw ID", async ({ page }) => {
  await openBuilder(page);
  const picker = page.getByRole("combobox", { name: /^Project/ });
  await expect(picker.locator("option")).toHaveText(["Pick a project", "SLC test (off: its campaigns are hidden in the app)", "Street Tally pilots"]);
  await page.getByRole("button", { name: "New project" }).click();
  const form = page.getByRole("group", { name: "New project" });
  await form.getByLabel("Name", { exact: true }).fill("slc TEST");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("alert")).toHaveText("A project named “slc TEST” already exists.");
  await form.getByLabel("Name", { exact: true }).fill("Sugar House");
  await form.getByLabel("Display name").fill("Sugar House walks");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(picker.locator("option:checked")).toHaveText("Sugar House walks");
  await expect(page.locator(".project-off")).toHaveCount(0);
  await page.getByText("Advanced: enter a project ID").click();
  await page.getByLabel("Project ID on this backend").fill("77");
  await page.getByRole("button", { name: "Use this ID" }).click();
  await expect(picker.locator("option:checked")).toHaveText("Project 77 (entered by ID)");
});
