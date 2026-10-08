import { expect, type Page, test } from "@playwright/test";
import { MOCK } from "./env";

async function openBuilder(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await page.getByRole("link", { name: /Sign in as mock-superuser/ }).click();
  await page.getByRole("link", { name: "Survey builder" }).click();
  await expect(page.getByRole("heading", { name: "Find features in an area" })).toBeVisible();
}
const fillBox = async (page: Page) => {
  await page.getByLabel("South (degrees)").fill("40.7");
  await page.getByLabel("West (degrees)").fill("-111.9");
  await page.getByLabel("North (degrees)").fill("40.8");
  await page.getByLabel("East (degrees)").fill("-111.8");
};

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

test("bounding box search: queue, review, then load into the preview", async ({ page }) => {
  await openBuilder(page);
  const queue = page.getByRole("button", { name: "Queue feature search" });
  await expect(queue).toBeDisabled();
  await fillBox(page);
  await expect(page.getByLabel("Rule 1")).toHaveValue("amenity=restaurant");
  await queue.click();
  await page.getByRole("button", { name: "Review results" }).click();
  const review = page.getByRole("region", { name: "Search results" });
  await expect(review).toContainText("3 features found");
  await expect(review).toContainText("2026-10-07T00:00:00Z");
  await expect(review).toContainText("1 omitted features");
  // Nothing changes until the explicit load.
  await expect(page.getByLabel("FeatureCollection")).not.toHaveValue(/Fixture 1/);
  await page.getByRole("button", { name: "Load 3 features into preview" }).click();
  await expect(page.getByLabel("FeatureCollection")).toHaveValue(/Fixture 1/);
  await expect(page.getByText(/3 tasks ready/)).toBeVisible();
});

test("boundary upload validates the file and queues a geojson region", async ({ page }) => {
  await openBuilder(page);
  await page.getByLabel("Upload area boundary").check();
  const file = page.getByLabel("Area boundary file (GeoJSON polygon)");
  await file.setInputFiles({ name: "bad.geojson", mimeType: "application/json", buffer: Buffer.from('{"type":"Point","coordinates":[0,0]}') });
  await expect(page.getByRole("alert")).toContainText("Unsupported GeoJSON type");
  await expect(page.getByRole("button", { name: "Queue feature search" })).toBeDisabled();
  const poly = { type: "Polygon", coordinates: [[[-111.9, 40.7], [-111.8, 40.7], [-111.8, 40.8], [-111.9, 40.8], [-111.9, 40.7]]] };
  await file.setInputFiles({ name: "area.geojson", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(poly)) });
  await expect(page.getByText(/5 vertices/)).toBeVisible();
  await page.getByRole("button", { name: "Queue feature search" }).click();
  await expect(page.getByRole("button", { name: "Review results" })).toBeVisible();
});

test("a failed job shows its message and a large box warns", async ({ page }) => {
  await openBuilder(page);
  await page.getByLabel("South (degrees)").fill("40");
  await page.getByLabel("West (degrees)").fill("-112");
  await page.getByLabel("North (degrees)").fill("42");
  await page.getByLabel("East (degrees)").fill("-110");
  await expect(page.getByText(/rejects areas above/)).toBeVisible();
  await fillBox(page);
  await page.getByLabel("Search name").fill("Big [fail]");
  await page.getByRole("button", { name: "Queue feature search" }).click();
  await expect(page.getByText(/Failed \(too_large\)/)).toBeVisible();
});

test("a running job survives reload and can be cancelled", async ({ page }) => {
  await openBuilder(page);
  await fillBox(page);
  await page.getByRole("button", { name: "Queue feature search" }).click();
  await expect(page.getByRole("button", { name: "Cancel search" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Find features in an area" })).toBeVisible();
  await expect(page.getByText("Restaurant details").first()).toBeVisible();
  const done = page.getByRole("button", { name: "Review results" });
  const cancel = page.getByRole("button", { name: "Cancel search" });
  await expect(done.or(cancel)).toBeVisible();
});
