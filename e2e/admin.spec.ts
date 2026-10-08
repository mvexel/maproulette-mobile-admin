import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { MOCK, PORTS } from "./env.ts";

interface Stats {
  authorizationCodes: number;
  refreshes: number;
  revokes: number;
  replays: number;
}
const stats = async (request: APIRequestContext) => (await (await request.get(`${MOCK}/__mock/stats`)).json()) as Stats;

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${MOCK}/__mock/reset`)).status()).toBe(204);
});

async function signIn(page: Page, as: "mock-superuser" | "mock-mapper" = "mock-superuser") {
  await page.goto("/");
  await expect(page.getByTestId("backend")).toHaveText(MOCK);
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:${PORTS.mock}/oauth/mobile/authorize\\?`));
  await page.getByRole("link", { name: new RegExp(`Sign in as ${as}`) }).click();
}

const row = (page: Page, id: string) => page.getByTestId(`client-${id}`);

test("signs in and shows the clients and the connected backend", async ({ page, request }) => {
  await signIn(page);
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("user")).toHaveText("mock-superuser");
  await expect(page.getByTestId("backend")).toHaveText(MOCK);
  await expect(row(page, "maproulette-mobile-admin")).toContainText("this app");
  await expect(row(page, "maproulette-android-example")).toBeVisible();
  expect((await stats(request)).authorizationCodes).toBe(1);
});

test("authorize request carries PKCE and the admin client", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await expect(page).toHaveURL(/authorize/);
  const q = new URL(page.url()).searchParams;
  expect(q.get("client_id")).toBe("maproulette-mobile-admin");
  expect(q.get("scope")).toBe("mobile:admin");
  expect(q.get("redirect_uri")).toBe("http://localhost:4173/callback");
  expect(q.get("code_challenge_method")).toBe("S256");
  expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("refreshes after a reload and after a 401", async ({ page, request }) => {
  await signIn(page);
  await expect(row(page, "maproulette-ios-example")).toBeVisible();

  // The access token is in memory only: a reload refreshes with the stored refresh token.
  await page.reload();
  await expect(row(page, "maproulette-ios-example")).toBeVisible();
  expect((await stats(request)).refreshes).toBe(1);

  // The server forgets the access token: the next call gets 401, refreshes once and retries.
  await request.post(`${MOCK}/__mock/expire-access`);
  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByTestId("audit-page")).toContainText("Page 1 of 3");
  const s = await stats(request);
  expect(s.refreshes).toBe(2);
  expect(s.replays).toBe(0);
});

test("explains that a non-super-user cannot sign in", async ({ page, request }) => {
  await signIn(page, "mock-mapper");
  await expect(page.getByRole("heading", { name: "Not a super-user" })).toBeVisible();
  await expect(page.getByTestId("backend")).toHaveText(MOCK);
  expect((await stats(request)).authorizationCodes).toBe(0);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with OpenStreetMap" })).toBeVisible();
});

test("creates, edits, disables and enables a client", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add client" }).click();
  const form = page.getByRole("form", { name: "New client" });
  await form.getByLabel("ID", { exact: true }).fill("org.example.app");
  await form.getByLabel("Name").fill("Example app");
  await form.getByLabel("Redirect URIs").fill("org.example.app:/oauth");
  await form.getByLabel("Scopes").selectOption("tasks:read tasks:write");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("status")).toHaveText("Created org.example.app.");
  await expect(row(page, "org.example.app")).toContainText("tasks:read tasks:write");
  await expect(row(page, "org.example.app")).toContainText("admin");

  await row(page, "org.example.app").getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit org.example.app" });
  await edit.getByLabel("Name").fill("Renamed app");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "org.example.app")).toContainText("Renamed app");

  await row(page, "org.example.app").getByRole("button", { name: "Disable" }).click();
  const dialog = page.getByRole("dialog", { name: "Disable org.example.app" });
  await dialog.getByLabel(/Also revoke all its sign-ins/).check();
  await dialog.getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("status")).toHaveText("Disabled org.example.app and revoked 0 sign-in(s).");
  await expect(row(page, "org.example.app")).toHaveClass(/disabled/);

  await row(page, "org.example.app").getByRole("button", { name: "Enable" }).click();
  await expect(page.getByRole("status")).toHaveText("Enabled org.example.app.");
  await expect(row(page, "org.example.app")).not.toHaveClass(/disabled/);
});

test("shows validation errors and duplicates", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add client" }).click();
  const form = page.getByRole("form", { name: "New client" });
  await form.getByLabel("ID", { exact: true }).fill("bad");
  await form.getByLabel("Name").fill("Bad");
  await form.getByLabel("Redirect URIs").fill("http://insecure.example/cb");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toContainText("The backend rejected the input:");
  await expect(form.getByRole("alert")).toContainText("redirectUris: 1 to 10 distinct URIs");

  await form.getByLabel("ID", { exact: true }).fill("maproulette-ios-example");
  await form.getByLabel("Redirect URIs").fill("org.example.app:/oauth");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(form.getByRole("alert")).toHaveText("A client with this ID already exists.");
});

test("refuses to lock the admin app out (self_lockout)", async ({ page }) => {
  await signIn(page);
  await row(page, "maproulette-mobile-admin").getByRole("button", { name: "Disable" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("alert")).toContainText("this would lock the admin app out");
  await expect(row(page, "maproulette-mobile-admin")).not.toHaveClass(/disabled/);

  await row(page, "maproulette-mobile-admin").getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit maproulette-mobile-admin" });
  await edit.getByLabel("Scopes").selectOption("tasks:read");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit.getByRole("alert")).toContainText("this would lock the admin app out");

  // Renaming works although its config redirect (http://localhost) would fail admin validation:
  // only changed fields are sent.
  await edit.getByLabel("Scopes").selectOption("mobile:admin");
  await edit.getByLabel("Name").fill("Admin (local)");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved maproulette-mobile-admin.");
  await expect(row(page, "maproulette-mobile-admin")).toContainText("Admin (local)");
});

test("pages through the audit log", async ({ page }) => {
  await signIn(page);
  await row(page, "maproulette-ios-example").getByRole("button", { name: "Disable" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disable" }).click();
  await expect(page.getByRole("status")).toHaveText("Disabled maproulette-ios-example.");

  await page.getByRole("link", { name: "Audit log" }).click();
  await expect(page).toHaveURL("/audit");
  const pageLabel = page.getByTestId("audit-page");
  await expect(pageLabel).toHaveText("Page 1 of 3 (61 entries)");
  await expect(page.getByTestId("audit-row")).toHaveCount(25);
  const newest = page.getByTestId("audit-row").first();
  await expect(newest).toContainText("client.update");
  await newest.getByText("Show").click();
  await expect(newest).toContainText('"enabled": false');

  await page.getByRole("button", { name: "Older" }).click();
  await expect(pageLabel).toHaveText("Page 2 of 3 (61 entries)");
  await page.getByRole("button", { name: "Older" }).click();
  await expect(pageLabel).toHaveText("Page 3 of 3 (61 entries)");
  await expect(page.getByTestId("audit-row")).toHaveCount(11);
  await expect(page.getByRole("button", { name: "Older" })).toBeDisabled();
  await page.getByRole("button", { name: "Newer" }).click();
  await expect(pageLabel).toHaveText("Page 2 of 3 (61 entries)");

  // Direct load of a deep link works (SPA fallback).
  await page.reload();
  await expect(pageLabel).toHaveText("Page 1 of 3 (61 entries)");
});

test("signs out and revokes the session", async ({ page, request }) => {
  await signIn(page);
  await expect(page.getByTestId("user")).toHaveText("mock-superuser");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in with OpenStreetMap" })).toBeVisible();
  await expect.poll(async () => (await stats(request)).revokes).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in with OpenStreetMap" })).toBeVisible();
});
