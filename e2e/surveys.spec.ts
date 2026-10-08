import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { exampleSurvey, generateTasks } from "../src/survey";
import { MOCK } from "./env";

async function openBuilder(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await page.getByRole("link", { name: "Survey builder" }).click();
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

test("creates disabled, imports reviewed existing-contract tasks, then publishes for Android", async ({ page }) => {
  const survey = exampleSurvey("restaurant");
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
  await page.getByLabel("Project ID on this backend").fill("1");
  await page.getByRole("button", { name: "Create new challenge" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Import 1 reviewed tasks" }).click();
  await expect(page.getByText("Created 1; updated 0; rejected 0.")).toBeVisible();
  await page.getByRole("button", { name: "Publish for Android" }).click();
  await expect(page.getByText("Refresh Challenges in the Android app to find this survey.")).toBeVisible();
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
  await page.getByLabel("Project ID on this backend").fill("1");
  await page.getByRole("button", { name: "Create new challenge" }).click();
  await page.getByRole("button", { name: "Import 1 reviewed tasks" }).click();
  await expect(page.getByRole("alert")).toContainText("Accepted lines may already exist");
  await expect(page.getByRole("button", { name: "Import 1 reviewed tasks" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Publish for Android" })).toHaveCount(0);
  expect(imports).toBe(1);
});

test("a partially rejected import cannot be published", async ({ page }) => {
  const survey = exampleSurvey("restaurant"); survey.features.features[0].properties["@id"] = "node/123";
  await page.route(`${MOCK}/api/v2/challenge`, route => route.fulfill({ status: 201, json: { id: 42 } }));
  await page.route(`${MOCK}/api/v2/challenge/42/addFileTasks?lineByLine=true&report=true`, route => route.fulfill({ json: { created: 0, updated: 0, rejected: [{ line: 1, errors: ["Feature rejected"] }] } }));
  await openBuilder(page);
  await page.getByLabel("Open survey file").setInputFiles({ name: "survey.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(survey)) });
  const exported = page.waitForEvent("download"); await page.getByRole("button", { name: "Export survey file" }).click(); await exported;
  await page.getByLabel("Project ID on this backend").fill("1");
  await page.getByRole("button", { name: "Create new challenge" }).click();
  await page.getByRole("button", { name: "Import 1 reviewed tasks" }).click();
  await expect(page.getByText("Line 1: Feature rejected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish for Android" })).toBeDisabled();
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
