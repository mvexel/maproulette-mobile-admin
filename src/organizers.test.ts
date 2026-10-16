import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MockBackend } from "../mock/server.ts";
import {
  type ApiError,
  addOrganizer,
  describeError,
  getWritePolicy,
  listCampaigns,
  listClients,
  listOrganizers,
  getChallenge,
  listProjects,
  publishSurveyChallenge,
  removeOrganizer,
  removeOrganizerProject,
  setProjectEnabled,
  setWritePolicy,
} from "./api";
import { clearSession } from "./auth";
import { reset, setUp, signIn } from "./testing";

let mock: MockBackend;
beforeAll(async () => {
  mock = await setUp();
});
afterAll(() => mock.close());
beforeEach(() => reset(mock));

/** A super-user turns saving on, then the organizer signs in again. */
async function turnWritesOn() {
  clearSession();
  await signIn(mock);
  await setWritePolicy(true);
  clearSession();
  await signIn(mock, "organizer");
}

const failure = (p: Promise<unknown>) => p.then(() => expect.fail("expected a rejection")).catch((e: unknown) => e as ApiError);

describe("organizers (D8)", () => {
  it("see their own projects and campaigns, and not the rest of the admin API", async () => {
    await signIn(mock, "organizer");
    expect((await listProjects()).map((p) => p.id)).toEqual([2]);
    expect(new Set((await listCampaigns()).map((c) => c.project.id))).toEqual(new Set([2]));
    expect((await getWritePolicy()).enabled).toBe(false);
    const off = await failure(setProjectEnabled(2, false));
    expect(off.code).toBe("mobile_writes_disabled");
    expect(describeError(off).message).toMatch(/Saving is off/);
    await turnWritesOn();
    expect((await setProjectEnabled(2, false)).enabled).toBe(false);
    const other = await failure(setProjectEnabled(1, true));
    expect(other.code).toBe("organizer_forbidden");
    expect(describeError(other).message).toMatch(/isn't one of yours/);
    expect((await failure(listClients())).code).toBe("insufficient_scope");
    expect((await failure(listOrganizers())).code).toBe("insufficient_scope");
  });

  it("read their campaigns through stock routes but don't write there", async () => {
    await signIn(mock, "organizer");
    const [mine] = (await listCampaigns()).filter((c) => c.project.id === 2);
    expect((await getChallenge(mine.id)).id).toBe(mine.id);
    expect((await failure(publishSurveyChallenge(mine.id))).code).toBe("insufficient_scope");
  });

  it("are added, moved between projects and removed by a super-user", async () => {
    await signIn(mock);
    expect((await listOrganizers()).map((o) => o.name)).toEqual(["mock-organizer"]);
    const missing = await failure(addOrganizer("nobody", 1, "write"));
    expect(describeError(missing).message).toMatch(/signed in to MapRoulette/);
    const added = await addOrganizer("MOCK-MAPPER", 1, "admin");
    expect(added).toMatchObject({ name: "mock-mapper", projects: [{ id: 1, role: "admin" }] });
    expect((await removeOrganizerProject(added.userId, 1)).projects).toEqual([]);
    await removeOrganizer(9);
    expect((await listOrganizers()).map((o) => o.name)).toEqual(["mock-mapper"]);

    // The removed organizer's next request is refused.
    clearSession();
    await expect(signIn(mock, "organizer")).rejects.toThrow(/set up to run campaigns/);
  });
});
