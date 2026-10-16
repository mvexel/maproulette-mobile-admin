import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MOCK_LIVE_TOKENS, type MockBackend, startMockBackend } from "../../../mock/server.ts";
import { configure } from "../config";
import { fetchReview, MarkError, mark, type ReviewPage, type ReviewPlace, type Suggestion, tokenFrom } from "./api";
import { accessToken, completeSignIn, displayName, signedIn, signOut, startSignIn } from "./session";
import { changesetComment, countsLine, currentLine, dayRange, idUrl, josmUrl, needsLook, reportText, shortDay, shown, stateHint, stateLabel, stateStyle, tagText, whoLine } from "./words";

const SITE = "https://site.test";
const T = MOCK_LIVE_TOKENS.live;

class MemoryStorage {
  private items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
  clear() {
    this.items.clear();
  }
}
const assign = vi.fn<(url: string) => void>();

const sug = (over: Partial<Suggestion> = {}): Suggestion => ({
  question: "door",
  answer: "sliding",
  label: "Slides sideways",
  tags: { door: "sliding" },
  people: 2,
  day: "2026-10-14",
  current: { door: null },
  ...over,
});
const place = (over: Partial<ReviewPlace> = {}): ReviewPlace => ({
  id: 1,
  osm: { type: "node", id: 42 },
  lon: 0,
  lat: 0,
  state: "open",
  suggestions: [sug()],
  reports: [],
  ...over,
});
const page = (over: Partial<ReviewPage> = {}): ReviewPage => ({
  campaign: { name: "Woodbine entrance doors", hashtags: ["#StreetTallyWoodbine"] },
  counts: { toReview: 47, added: 12, needsVisit: 3 },
  places: [place()],
  ...over,
});

describe("review page words (handback-copy §2)", () => {
  it("writes the header counts with plurals", () => {
    expect(countsLine(page())).toBe("47 answers to review · 12 added · 3 need a visit");
    expect(countsLine(page({ counts: { toReview: 1, added: 0, needsVisit: 1 } }))).toBe("1 answer to review · 0 added · 1 needs a visit");
    expect(countsLine(page({ counts: { toReview: 1, added: 0, needsVisit: 0, stale: 2, gone: 0, disagree: 1 } }))).toBe(
      "1 answer to review · 0 added · 0 need a visit · 1 with different answers · 2 changed on OSM",
    );
  });

  it("shows days only, people counts and what OSM has now", () => {
    expect(shortDay("2026-10-14")).toBe("14 Oct");
    expect(whoLine({ people: 2, day: "2026-10-14" })).toBe("2 people, 14 Oct");
    expect(whoLine({ people: 1, day: "2026-10-14" })).toBe("1 person, 14 Oct");
    expect(currentLine(sug())).toBe("On OSM now: not set");
    expect(currentLine(sug({ current: { door: "hinged" } }))).toBe("On OSM now: door=hinged");
    expect(reportText({ outcome: "moved", label: "It's moved", people: 1, day: "2026-10-14" })).toBe("It's moved");
    expect(reportText({ outcome: "no_door", label: "", people: 1, day: "2026-10-14" })).toBe("no_door");
  });

  it("filters: 2 people agree is a filter on open places, done is the server's", () => {
    expect(shown(place(), "agree")).toBe(true);
    expect(shown(place({ suggestions: [sug({ people: 1 })] }), "agree")).toBe(false);
    expect(shown(place({ state: "done" }), "agree")).toBe(false);
    expect(shown(place({ state: "done" }), "done")).toBe(true);
    expect(shown(place({ state: "needs_visit" }), "visit")).toBe(true);
    expect(shown(place({ state: "needs_visit" }), "all")).toBe(true);
  });

  it("labels places that aren't a tag change as Needs a look", () => {
    const look = place({ suggestions: [], reports: [{ outcome: "not_here", label: "It's not here", people: 1, day: "2026-10-14" }] });
    expect(needsLook(look)).toBe(true);
    expect(stateLabel(look)).toBe("Needs a look");
    expect(stateLabel(place())).toBeUndefined();
    expect(stateLabel(place({ state: "done" }))).toBe("On the map");
    expect(stateLabel(place({ state: "needs_visit" }))).toBe("Needs a visit");
    expect(stateLabel(place({ state: "disagree" }))).toBe("Answers differ");
    expect(stateLabel(place({ state: "stale" }))).toBe("Changed on OSM");
    expect(stateLabel(place({ state: "gone" }))).toBe("Needs a look");
    expect([place(), place({ suggestions: [] }), place({ state: "stale" }), place({ state: "done" })].map(stateStyle)).toEqual(["open", "look", "look", "done"]);
    expect(stateHint(place())).toBeUndefined();
    expect(stateHint(place({ state: "stale" }))).toMatch(/^OpenStreetMap changed here/);
    // A held-back place opens in JOSM without tags, so nothing goes in unchecked.
    expect(new URL(josmUrl(place({ state: "disagree" }))).searchParams.has("addtags")).toBe(false);
    // Keys people answered differently stay out; agreed keys go in once (Tess, R-8 on dev 212).
    const split = place({
      suggestions: [sug({ tags: { armrest: "yes", colour: "brown" } }), sug({ tags: { armrest: "no", colour: "brown" } }), sug({ tags: { armrest: "yes" } })],
    });
    expect(new URL(josmUrl(split)).searchParams.get("addtags")).toBe("colour=brown");
  });

  it("opens JOSM with the suggested tags and iD on the object only", () => {
    const p = place({ suggestions: [sug(), sug({ tags: { automatic_door: "motion", fixme: null } })] });
    const j = new URL(josmUrl(p));
    expect(`${j.origin}${j.pathname}`).toBe("http://127.0.0.1:8111/load_object");
    expect(j.searchParams.get("objects")).toBe("n42");
    expect(j.searchParams.get("addtags")).toBe("door=sliding|automatic_door=motion|fixme=");
    expect(tagText({ automatic_door: "motion", fixme: null })).toBe("automatic_door=motion · remove fixme");
    expect(new URL(josmUrl(place({ osm: { type: "way", id: 7 }, suggestions: [] }))).searchParams.has("addtags")).toBe(false);
    expect(idUrl(place({ osm: { type: "way", id: 7 } }), "https://www.openstreetmap.org")).toBe("https://www.openstreetmap.org/edit?editor=id&way=7");
  });

  it("suggests a changeset comment with the survey days and hashtags", () => {
    const p = page({ places: [place(), place({ suggestions: [sug({ day: "2026-10-13" })] })] });
    expect(changesetComment(p)).toBe(
      "From a Street Tally survey for Woodbine entrance doors, 13–14 Oct. Checked by me. #StreetTally #StreetTallyWoodbine",
    );
    expect(dayRange("2026-10-14", "2026-10-14")).toBe("14 Oct");
    expect(dayRange("2026-09-30", "2026-10-02")).toBe("30 Sept–2 Oct");
    expect(changesetComment(page({ campaign: { name: "x", hashtags: [], changesetComment: "Server's own" } }))).toBe("Server's own");
  });
});

describe("review page API and sign-in", () => {
  let mock: MockBackend;
  beforeAll(async () => {
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.stubGlobal("location", { origin: SITE, assign });
    mock = await startMockBackend({ adminOrigin: "https://admin.test", claimOrigin: SITE });
    configure({ backend: mock.url, clientId: "maproulette-claim" });
  });
  afterAll(() => mock.close());
  beforeEach(async () => {
    await signOut();
    sessionStorage.clear();
    mock.reset();
  });

  async function signIn() {
    await startSignIn();
    const authorize = new URL(assign.mock.calls.at(-1)?.[0] ?? "");
    expect(authorize.searchParams.get("client_id")).toBe("street-tally-review");
    expect(authorize.searchParams.get("scope")).toBe("tasks:read");
    const html = await (await fetch(authorize)).text();
    const decide = [...html.matchAll(/href="([^"]+&as=(\w+))"/g)].find((m) => m[2] === "plain")?.[1] ?? "";
    const back = await fetch(new URL(decide.replaceAll("&amp;", "&"), mock.url), { redirect: "manual" });
    const target = new URL(back.headers.get("location") ?? "");
    expect(`${target.origin}${target.pathname}`).toBe(`${SITE}/review/callback`);
    await completeSignIn(target.searchParams);
  }

  it("takes the token from /review/<token> only", () => {
    expect(tokenFrom(`/review/${T}`)).toBe(T);
    expect(tokenFrom(`/live/${T}`)).toBeUndefined();
    expect(tokenFrom("/review/short")).toBeUndefined();
  });

  it("reads the page without signing in, and tells a turned-off page and a bad link apart", async () => {
    const r = await fetchReview(T);
    expect("page" in r && r.page.places.length).toBe(8);
    expect("page" in r && r.page.places.some((p) => "skipped" in p)).toBe(false);
    expect(await fetchReview(MOCK_LIVE_TOKENS.off)).toEqual({ problem: "off" });
    expect(await fetchReview("x".repeat(43))).toEqual({ problem: "missing" });
  });

  it("needs a sign-in to mark", async () => {
    await expect(mark(T, 201, "skip", true, "x".repeat(43))).rejects.toEqual(new MarkError(401, "sign_in_required"));
  });

  it("signs in read-only, skips for this mapper and marks a visit for everyone", async () => {
    await signIn();
    expect(signedIn()).toBe(true);
    expect(displayName()).toBe("mock-mapper");
    expect((await mark(T, 201, "skip", true, await accessToken())).skipped).toBe(true);
    expect((await mark(T, 202, "needs-visit", true, await accessToken())).state).toBe("needs_visit");
    const mine = await fetchReview(T, await accessToken());
    expect("page" in mine && mine.page.places.find((p) => p.id === 201)?.skipped).toBe(true);
    expect("page" in mine && mine.page.counts.needsVisit).toBe(2);
    const anyone = await fetchReview(T);
    expect("page" in anyone && anyone.page.places.find((p) => p.id === 202)?.state).toBe("needs_visit");
    expect((await mark(T, 201, "skip", false, await accessToken())).skipped).toBe(false);
    expect((await mark(T, 202, "needs-visit", false, await accessToken())).state).toBe("open");
    await expect(mark(T, 204, "needs-visit", true, await accessToken())).rejects.toEqual(new MarkError(409, "done"));
  });
});
