import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MOCK_LIVE_TOKENS, type MockBackend, startMockBackend } from "../../../mock/server.ts";
import { configure } from "../config";
import { fetchLive, type LivePage, type LiveStop, tokenFrom } from "./api";
import { ago, label, noun, recent, subLine, tallyLine, when } from "./words";

const page = (over: Partial<LivePage> = {}): LivePage => ({
  campaign: { name: "Woodbine entrances", hashtags: [], match: { entrance: "main" } },
  mode: "live",
  answersShown: false,
  generatedAt: "2026-10-18T23:30:00Z",
  tally: { checked: 9, total: 16, needsLook: 1, people: 4 },
  stops: [],
  ...over,
});
const stop = (over: Partial<LiveStop> = {}): LiveStop => ({ id: 1, lon: 0, lat: 0, state: "checked", ...over });
const ENTRANCE = { one: "entrance", many: "entrances" };

describe("live page words", () => {
  it("names places like the apps do", () => {
    expect(noun({ entrance: "main" })).toEqual(ENTRANCE);
    expect(noun({ entrance: "yes" })).toEqual(ENTRANCE);
    expect(noun({ highway: "bus_stop" })).toEqual({ one: "stop", many: "stops" });
    expect(noun({ highway: "street_lamp" })).toEqual({ one: "place", many: "places" });
    expect(label({ name: "Granary Live" }, ENTRANCE)).toBe("Granary Live");
    expect(label({ ref: "B" }, ENTRANCE)).toBe("Entrance B");
    expect(label({}, ENTRANCE)).toBe("Entrance");
  });

  it("writes the tally with plurals and no zero clause while live (review L3)", () => {
    expect(tallyLine(page(), ENTRANCE)).toEqual({ checked: 9, rest: " of 16 entrances checked" });
    expect(subLine(page())).toBe("1 needs another look · 4 people tonight");
    expect(subLine(page({ tally: { checked: 1, total: 1, needsLook: 0, people: 1 } }))).toBe("1 person tonight");
    expect(subLine(page({ tally: { checked: 1, total: 3, needsLook: 2 } }))).toBe("2 need another look");
    expect(subLine(page({ mode: "ended", endedAt: "2026-10-18T23:45:00Z", tally: { checked: 3, total: 3, needsLook: 0 } }))).toBe(
      "Surveyed 18 October 2026 · None need another look",
    );
  });

  it("keeps times coarse, and gives the date once ended (L4, L8)", () => {
    expect(ago(3)).toBe("in the last 15 min");
    expect(ago(22)).toBe("20 min ago");
    expect(ago(65)).toBe("1 h ago");
    expect(ago(130)).toBe("2 h ago");
    expect(when(stop({ at: "2026-10-18T23:08:00Z" }), page())).toBe("Checked 20 min ago");
    expect(when(stop({ state: "look", at: "2026-10-18T23:25:00Z" }), page())).toBe("Someone couldn't check it in the last 15 min");
    expect(when(stop({ state: "look", at: "2026-10-18T22:00:00Z" }), page({ mode: "ended" }))).toBe("Someone couldn't check it on 18 October");
    expect(when(stop({ state: "todo" }), page())).toBeUndefined();
  });

  it("pulses only stops checked in the last 10 minutes while live", () => {
    expect(recent(stop({ at: "2026-10-18T23:22:00Z" }), page())).toBe(true);
    expect(recent(stop({ at: "2026-10-18T23:10:00Z" }), page())).toBe(false);
    expect(recent(stop({ at: "2026-10-18T23:22:00Z" }), page({ mode: "ended" }))).toBe(false);
    expect(recent(stop({ state: "look", at: "2026-10-18T23:22:00Z" }), page())).toBe(false);
  });
});

describe("live page API", () => {
  let mock: MockBackend;
  beforeAll(async () => {
    mock = await startMockBackend({ adminOrigin: "https://admin.test", claimOrigin: "https://site.test" });
    configure({ backend: mock.url, clientId: "maproulette-claim" });
  });
  afterAll(() => mock.close());

  it("takes the token from /live/<token> only", () => {
    expect(tokenFrom(`/live/${MOCK_LIVE_TOKENS.live}`)).toBe(MOCK_LIVE_TOKENS.live);
    expect(tokenFrom(`/live/${MOCK_LIVE_TOKENS.live}/`)).toBe(MOCK_LIVE_TOKENS.live);
    expect(tokenFrom("/live/short")).toBeUndefined();
    expect(tokenFrom(`/claim/${MOCK_LIVE_TOKENS.live}`)).toBeUndefined();
  });

  it("tells a live page, a turned-off page and a bad link apart", async () => {
    const live = await fetchLive(MOCK_LIVE_TOKENS.live);
    expect("page" in live && live.page.tally.total).toBe(5);
    expect(await fetchLive(MOCK_LIVE_TOKENS.off)).toEqual({ problem: "off" });
    expect(await fetchLive("x".repeat(43))).toEqual({ problem: "missing" });
  });
});
