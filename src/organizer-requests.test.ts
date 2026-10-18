import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MockBackend } from "../mock/server.ts";
import {
  type ApiError,
  approveOrganizerRequest,
  askToOrganize,
  declineOrganizerRequest,
  describeError,
  listCampaigns,
  listOrganizerRequests,
  listOrganizers,
  myOrganizerRequest,
} from "./api";
import { clearSession, role } from "./auth";
import { reset, setUp, signIn } from "./testing";

let mock: MockBackend;
beforeAll(async () => {
  mock = await setUp();
});
afterAll(() => mock.close());
beforeEach(() => reset(mock));

const failure = (p: Promise<unknown>) => p.then(() => expect.fail("expected a rejection")).catch((e: unknown) => e as ApiError);
const ask = { place: "Woodbine, Toronto", subject: "Entrances and crossings" };

describe("organizer requests (ORG-ONB)", () => {
  it("lets someone who isn't an organizer ask once, and shows them where it stands", async () => {
    await signIn(mock, "plain");
    expect(role()).toBe("requester");
    expect(await myOrganizerRequest()).toEqual({ organizer: false, canRequest: true, askAgainAt: null, request: null });
    const sent = await askToOrganize({ ...ask, group: "Woodbine BIA" });
    expect(sent).toMatchObject({ state: "open", place: "Woodbine, Toronto", group: "Woodbine BIA" });
    expect(await myOrganizerRequest()).toMatchObject({ canRequest: false, request: { state: "open" } });
    const again = await failure(askToOrganize(ask));
    expect(again.code).toBe("request_open");
    expect(describeError(again).message).toMatch(/already asked/);
    // The request grant reaches nothing else.
    expect((await failure(listCampaigns())).code).toBe("insufficient_scope");
  });

  it("are listed for super-users with the OSM account snapshot, and approved as one step", async () => {
    await signIn(mock);
    const [open] = await listOrganizerRequests();
    expect(open).toMatchObject({ user: { name: "rosa_slc" }, place: "Sugar House, Salt Lake City", osmAccount: { changesets: 3 } });
    const taken = await failure(approveOrganizerRequest(open.id, "Street Tally pilots"));
    expect(taken.code).toBe("project_exists");
    await approveOrganizerRequest(open.id, "Sugar House");
    expect(await listOrganizerRequests()).toEqual([]);
    const rosa = (await listOrganizers()).find((o) => o.name === "rosa_slc");
    expect(rosa?.projects.map((p) => [p.name, p.role])).toEqual([["Sugar House", "write"]]);
    expect((await failure(approveOrganizerRequest(open.id, "Again"))).code).toBe("request_decided");

    // Their next sign-in is an organizer's, and the note knows it was approved (§2.4).
    clearSession();
    await signIn(mock, "asker");
    expect(role()).toBe("organizer");
    expect(await myOrganizerRequest()).toMatchObject({ organizer: true, request: { state: "approved" } });
  });

  it("shows a decline's note, and keeps the form away for 30 days", async () => {
    await signIn(mock, "plain");
    await askToOrganize(ask);
    clearSession();
    await signIn(mock);
    const mine = (await listOrganizerRequests()).find((r) => r.user.name === "mock-mapper");
    await declineOrganizerRequest(mine!.id, "  Try the Toronto group first.  ");
    clearSession();
    await signIn(mock, "plain");
    const now = await myOrganizerRequest();
    expect(now).toMatchObject({ canRequest: false, request: { state: "declined", note: "Try the Toronto group first." } });
    expect(Date.parse(now.askAgainAt!) - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect((await failure(askToOrganize(ask))).code).toBe("too_soon");
  });

  it("comes back after 30 days", async () => {
    await signIn(mock, "plain");
    await askToOrganize(ask);
    const longAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await fetch(`${mock.url}/__mock/organizer-requests/user/8/decline?decidedAt=${longAgo}`, { method: "POST" });
    expect(await myOrganizerRequest()).toMatchObject({ canRequest: true, askAgainAt: null, request: { state: "declined" } });
    expect((await askToOrganize(ask)).state).toBe("open");
  });
});
