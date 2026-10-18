import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { MOCK } from "./env.ts";

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

async function signIn(page: Page, as: "mock-superuser" | "mock-mapper" | "mock-organizer" = "mock-superuser") {
  await page.goto("/");
  await expect(page.getByTestId("backend")).toHaveText(MOCK);
  await page.getByRole("button", { name: "Sign in with OpenStreetMap" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:9300\/oauth\/mobile\/authorize\?/);
  await page.getByRole("link", { name: new RegExp(`Sign in as ${as}`) }).click();
  if (as === "mock-superuser") await page.getByRole("link", { name: "Clients" }).click();
  else {
    // Not a super-user: the app asks again for mobile:organize. The real OSM sign-in is remembered.
    await expect(page).toHaveURL(/authorize\?.*scope=mobile%3Aorganize/);
    await page.getByRole("link", { name: new RegExp(`Sign in as ${as}`) }).click();
  }
}

const row = (page: Page, id: string) => page.getByTestId(`client-${id}`);

test("signs in and shows the clients and the connected backend", async ({ page, request }) => {
  await signIn(page);
  await expect(page).toHaveURL("/clients");
  await expect(page.getByTestId("user")).toHaveText("mock-superuser");
  await expect(page.getByTestId("environment")).toHaveText(`DEV backend: ${MOCK}`);
  await expect(page.getByTestId("environment")).toHaveAttribute("data-backend", MOCK);
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

test("explains that someone neither super-user nor organizer isn't set up while requests are closed", async ({ page, request }) => {
  await request.post(`${MOCK}/__mock/organizer-requests?open=false`);
  await signIn(page, "mock-mapper");
  // Requests are closed: the backend refuses mobile:organizer-request too.
  await expect(page).toHaveURL(/authorize\?.*scope=mobile%3Aorganizer-request/);
  await page.getByRole("link", { name: /Sign in as mock-mapper/ }).click();
  await expect(page.getByRole("heading", { name: "You're not an organizer yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask to become an organizer" })).toHaveAttribute("href", "mailto:martijn@osm.lol?subject=Street%20Tally%20organizer");
  await expect(page.getByTestId("backend")).toHaveText(MOCK);
  expect((await stats(request)).authorizationCodes).toBe(0);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with OpenStreetMap" })).toBeVisible();
});

test("shows an organizer their campaigns and Help only", async ({ page }) => {
  await signIn(page, "mock-organizer");
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("user")).toHaveText("mock-organizer");
  await expect(page.getByRole("navigation").getByRole("link")).toHaveText(["Campaigns", "Help"]);
  await expect(page.getByText("SLC Bus Stops")).toBeVisible();
  await expect(page.getByText("Street Tally test: 1300 S 900 E bus stops")).toHaveCount(0);
  await expect(page.getByTestId("writes-pill")).not.toHaveAttribute("href");
  // Organizers read the switch as what it means for them (W-EASY L5).
  await expect(page.getByTestId("writes-pill")).toHaveText("Publishing off");
  await expect(page.getByTestId("writes-pill")).toHaveAttribute("title", "You can save drafts. Publishing is turned off for now.");
  await page.goto("/clients");
  await expect(page.getByText("This page is for the Street Tally team. Your campaigns are under Campaigns.")).toBeVisible();
  // Organizers create with the wizard; the survey builder and stock Publish write through stock
  // routes, which organizer grants can't.
  await page.goto("/new");
  await expect(page.getByRole("heading", { name: "New campaign" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Advanced: build from a survey file" })).toHaveCount(0);
  await page.goto("/new/advanced");
  await expect(page.getByText("This page is for the Street Tally team.", { exact: false })).toBeVisible();
  await page.goto("/campaigns/3");
  await expect(page.getByText("No campaign 3 in the projects you organize.")).toBeVisible();
  await page.goto("/campaigns/9");
  await expect(page.getByText("Draft: not in the app yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("adds and removes an organizer", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Organizers" }).click();
  await expect(page.getByTestId("organizer-9")).toContainText("Street Tally pilots");
  await page.getByLabel("OpenStreetMap username").fill("mock-mapper");
  await page.locator(".organizer-form select").first().selectOption({ label: "SLC test" });
  await page.getByRole("button", { name: "Add organizer" }).click();
  await expect(page.getByRole("status")).toHaveText("Added mock-mapper.");
  await expect(page.getByTestId("organizer-8")).toContainText("SLC test (write)");
  await page.getByTestId("organizer-8").getByRole("button", { name: "Remove organizer" }).click();
  await expect(page.getByRole("status")).toContainText("can no longer run campaigns");
  await expect(page.getByTestId("organizer-8")).toHaveCount(0);
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

test("gives an app client the guest scope for deferred sign-up", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add client" }).click();
  const form = page.getByRole("form", { name: "New client" });
  await form.getByLabel("ID", { exact: true }).fill("org.example.guests");
  await form.getByLabel("Name").fill("Guest app");
  await form.getByLabel("Redirect URIs").fill("org.example.guests:/oauth");
  await form.getByLabel("Scopes").selectOption("tasks:read tasks:write osm:tagfix guest");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("status")).toHaveText("Created org.example.guests.");
  await expect(row(page, "org.example.guests")).toContainText("tasks:read tasks:write osm:tagfix guest");

  // An existing client moves onto it too, and the editor shows it selected afterwards.
  await row(page, "org.example.guests").getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("form", { name: "Edit org.example.guests" });
  await expect(edit.getByLabel("Scopes")).toHaveValue("tasks:read tasks:write osm:tagfix guest");
  await edit.getByLabel("Scopes").selectOption("tasks:read tasks:write osm:tagfix");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(row(page, "org.example.guests")).not.toContainText("osm:tagfix guest");
});

test("offers the scope sets the backend lists, including tasks:edit", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Add client" }).click();
  const form = page.getByRole("form", { name: "New client" });
  await form.getByLabel("ID", { exact: true }).fill("org.example.editor");
  await form.getByLabel("Name").fill("Editor");
  await form.getByLabel("Redirect URIs").fill("org.example.editor:/oauth");
  await form.getByLabel("Scopes").selectOption("tasks:read tasks:write tasks:edit");
  await form.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("status")).toHaveText("Created org.example.editor.");
  await expect(row(page, "org.example.editor")).toContainText("tasks:read tasks:write tasks:edit");
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

test("shows whether task writes are on, and follows a change", async ({ page }) => {
  await signIn(page);
  const pill = page.getByTestId("writes-pill");
  await expect(pill).toHaveText("Writes off");
  await pill.click();
  await expect(page).toHaveURL("/writes");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Enable writes" }).click();
  await expect(pill).toHaveText("Writes on");
});

test("lists a challenge's not-here and moved reports with iD links", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await signIn(page);
  await expect(page.getByTestId("user")).toHaveText("mock-superuser");
  await page.getByRole("link", { name: "New campaign" }).click();
  await page.getByRole("link", { name: "Advanced: build from a survey file" }).click();
  await page.getByText("Advanced: import a task file into an existing challenge").click();
  const panel = page.locator(".panel:has(> h3:text-is('Reports'))");
  await panel.getByLabel("Challenge ID").fill("12345");
  await panel.getByRole("button", { name: "Show reports" }).click();
  await expect(panel).toContainText("No challenge with ID 12345.");
  await panel.getByLabel("Challenge ID").fill("42");
  await panel.getByRole("button", { name: "Show reports" }).click();
  const rows = panel.getByRole("table", { name: "Reports" }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("900 E / 1300 S");
  await expect(rows.nth(0)).toContainText("It's moved, about 21 m (tapped on the map)");
  await expect(rows.nth(0)).toContainText("Oct 10, 5:10 pm");
  await expect(rows.nth(0).getByRole("link", { name: "Open in iD" })).toHaveAttribute("href", /node=103#map=20\/40\.760910\/-111\.891200$/);
  await expect(rows.nth(1)).toContainText("Stop 1234");
  await expect(rows.nth(1)).toContainText("It's not here");
  await expect(rows.nth(1).getByRole("link", { name: "Open in iD" })).toHaveAttribute("href", /node=102#map=20\/40\.761200\/-111\.892000$/);
  await panel.screenshot({ path: "test-results/reports-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const cards = panel.getByRole("list", { name: "Reports" }).getByRole("listitem");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(1)).toContainText("Oct 10, 5:05 pm · 2 reports");
  await panel.screenshot({ path: "test-results/reports-mobile.png" });
});
