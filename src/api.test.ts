import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MockBackend } from "../mock/server.ts";
import { RESULTS_CHALLENGE_ID, RESULTS_CSV } from "../mock/server.ts";
import { ApiError, createClient, describeError, fetchChallengeResults, idEditorUrl, listReports, stopLabel, getWritePolicy, listAudit, listClients, listScopeSets, setWritePolicy, updateClient } from "./api";
import { shortDateTime } from "./format";
import { reset, setUp, signIn } from "./testing";

let mock: MockBackend;
beforeAll(async () => {
  mock = await setUp();
});
afterAll(() => mock.close());
beforeEach(async () => {
  reset(mock);
  await signIn(mock);
});

const failure = (p: Promise<unknown>) => p.then(() => expect.fail("expected a rejection")).catch((e: unknown) => e as ApiError);

const newClient = {
  id: "org.example.app",
  name: "Example",
  redirectUris: ["org.example.app:/oauth"],
  scopes: ["tasks:read", "tasks:write"],
  enabled: true,
};

describe("clients", () => {
  it("lists clients ordered by id, with their source", async () => {
    const clients = await listClients();
    expect(clients.map((c) => c.id)).toEqual([
      "maproulette-android-example",
      "maproulette-ios-example",
      "maproulette-mobile-admin",
    ]);
    expect(clients[0]).toMatchObject({ source: "config", createdBy: null, enabled: true });
  });

  it("lists the scope sets a client may hold, and accepts each of them", async () => {
    const sets = await listScopeSets();
    expect(sets).toContainEqual(["tasks:read", "tasks:write", "tasks:edit"]);
    expect(sets).toContainEqual(["mobile:admin"]);
    for (const [i, scopes] of sets.entries())
      expect((await createClient({ ...newClient, id: `org.example.app${i}`, scopes })).scopes).toEqual(scopes);
  });

  it("creates a client and records it in the audit log", async () => {
    expect(await createClient(newClient)).toEqual(newClient);
    const created = (await listClients()).find((c) => c.id === newClient.id);
    expect(created).toMatchObject({ source: "admin", createdBy: 7 });
    const audit = await listAudit(0, 1);
    expect(audit.items[0]).toMatchObject({ action: "client.create", target: newClient.id, after: newClient });
  });

  it("refuses a duplicate id with 409 client_exists", async () => {
    const e = await failure(createClient({ ...newClient, id: "maproulette-ios-example" }));
    expect(e).toMatchObject({ status: 409, code: "client_exists" });
  });

  it("returns validation errors as detail", async () => {
    const e = await failure(createClient({ ...newClient, name: " padded", redirectUris: ["http://insecure/cb"] }));
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(400);
    expect(e.code).toBe("invalid_request");
    expect(e.detail).toHaveLength(2);
    expect(describeError(e).detail).toEqual(e.detail);
  });

  it("patches a client", async () => {
    const r = await updateClient("maproulette-ios-example", { name: "iOS" });
    expect(r).toMatchObject({ id: "maproulette-ios-example", name: "iOS", enabled: true });
    expect(r.revokedGrantFamilies).toBeUndefined();
  });

  it("disables with revokeGrants and reports the count", async () => {
    const r = await updateClient("maproulette-android-example", { enabled: false }, true);
    expect(r).toMatchObject({ enabled: false, revokedGrantFamilies: 0 });
  });

  it("needs enabled:false for revokeGrants", async () => {
    const e = await failure(updateClient("maproulette-android-example", { name: "x" }, true));
    expect(e).toMatchObject({ status: 400, code: "invalid_request", detail: ['revokeGrants needs "enabled": false'] });
  });

  it("refuses to lock the admin app out (409 self_lockout)", async () => {
    for (const patch of [{ enabled: false }, { scopes: ["tasks:read"] }]) {
      const e = await failure(updateClient("maproulette-mobile-admin", patch));
      expect(e).toMatchObject({ status: 409, code: "self_lockout" });
      expect(describeError(e).message).toMatch(/lock the admin app out/);
    }
    expect((await listClients()).find((c) => c.id === "maproulette-mobile-admin")?.enabled).toBe(true);
  });

  it("returns 404 not_found for an unknown client", async () => {
    const e = await failure(updateClient("nope", { name: "x" }));
    expect(e).toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("audit", () => {
  it("pages newest first", async () => {
    const first = await listAudit(0, 25);
    expect(first).toMatchObject({ page: 0, limit: 25, total: 60 });
    expect(first.items).toHaveLength(25);
    expect(first.items[0].id).toBe(60);
    const last = await listAudit(2, 25);
    expect(last.items.map((i) => i.id)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("rejects an out-of-range limit", async () => {
    const e = await failure(listAudit(0, 500));
    expect(e).toMatchObject({ status: 400, code: "invalid_request" });
  });
});

describe("write policy", () => {
  it("starts off and audits each state change", async () => {
    expect(await getWritePolicy()).toEqual({ enabled: false, managed: true });
    expect(await setWritePolicy(true)).toEqual({ enabled: true, managed: true });
    expect(await setWritePolicy(true)).toEqual({ enabled: true, managed: true });
    expect(await setWritePolicy(false)).toEqual({ enabled: false, managed: true });
    const page = await listAudit(0, 2);
    expect(page.items.map((entry) => entry.action)).toEqual(["write_policy.update", "write_policy.update"]);
  });
});

describe("results export", () => {
  it("downloads a challenge's results as CSV and GeoJSON", async () => {
    const csv = await fetchChallengeResults(RESULTS_CHALLENGE_ID, "csv");
    expect(csv.filename).toBe(`challenge-${RESULTS_CHALLENGE_ID}-results.csv`);
    expect(await csv.blob.text()).toBe(RESULTS_CSV);
    const geojson = await fetchChallengeResults(RESULTS_CHALLENGE_ID, "geojson");
    expect(geojson.filename).toBe(`challenge-${RESULTS_CHALLENGE_ID}-results.geojson`);
    expect(JSON.parse(await geojson.blob.text()).features[0].properties.answers).toEqual({ shelter: "yes" });
  });

  it("returns 404 not_found for an unknown challenge", async () => {
    const e = await failure(fetchChallengeResults(12345, "csv"));
    expect(e.status).toBe(404);
    expect(e.code).toBe("not_found");
  });
});

describe("reports", () => {
  it("lists not-here and moved reports, newest first, with the moved spot", async () => {
    const reports = await listReports(RESULTS_CHALLENGE_ID);
    expect(reports.map((r) => [r.taskId, r.outcome, r.count])).toEqual([[3, "moved", 1], [2, "not-here", 2]]);
    expect(reports[0].moved).toEqual({ at: [-111.8912, 40.76091], source: "tap", distanceM: 21 });
    expect(reports[1].moved).toBeUndefined();
    expect(reports.map((r) => r.label)).toEqual(["900 E / 1300 S", "Stop 1234"]);
  });

  it("labels a stop by name, then ref, then as unnamed", () => {
    expect(stopLabel("Main St", "9")).toBe("Main St");
    expect(stopLabel(null, "9")).toBe("Stop 9");
    expect(stopLabel(undefined, null)).toBe("Unnamed stop");
  });

  it("formats report times without seconds or year", () => {
    expect(shortDateTime("2026-10-10T17:05:00")).toBe("Oct 10, 5:05 pm");
    expect(shortDateTime("2026-01-02T09:30:00")).toBe("Jan 2, 9:30 am");
  });

  it("links iD to the element, centered on a point", () => {
    expect(idEditorUrl("node/103", [-111.8912, 40.76091])).toBe("https://www.openstreetmap.org/edit?editor=id&node=103#map=20/40.760910/-111.891200");
    expect(idEditorUrl("way/7")).toBe("https://www.openstreetmap.org/edit?editor=id&way=7");
  });
});
