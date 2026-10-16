import { describe, expect, it } from "vitest";
import type { Campaign } from "./api";
import { appState, fromLocalInput, liveLink, progressText, queueSummary, relativeTime, toLocalInput } from "./campaigns";

const project = { id: 1, name: "P", displayName: null, enabled: true };
const c = (enabled: boolean, published: boolean, projectOn = true): Campaign => ({
  id: 3,
  name: "C",
  enabled,
  published,
  listed: enabled && published && projectOn,
  modified: "2026-10-11T00:00:00Z",
  project: { ...project, enabled: projectOn },
  tasks: { total: 0, checked: 0, needsLook: 0 },
});

describe("campaigns", () => {
  it("names where a campaign stands in the app", () => {
    expect(appState(c(true, true))).toBe("listed");
    expect(appState(c(true, true, false))).toBe("project-off");
    expect(appState(c(false, true))).toBe("turned-off");
    expect(appState(c(true, false))).toBe("not-published");
    expect(appState(c(false, false))).toBe("draft");
  });

  it("sums up a confirm queue run, leaving out zeros", () => {
    const none = { queueChallengeId: 0, queued: 0, alreadyQueued: 0, done: 0, stale: 0, gone: 0, disagree: 0 };
    expect(queueSummary(none)).toBe("0 suggestions added.");
    expect(queueSummary({ ...none, queueChallengeId: 77, queued: 1, alreadyQueued: 3, done: 2, stale: 1, gone: 2, disagree: 1 })).toBe(
      "1 suggestion added · 3 already in the queue · 2 already on the map · 1 place changed on OSM since the survey · " +
        "2 places deleted from OSM · 1 question where people gave different answers.",
    );
  });

  it("writes progress as the app does", () => {
    expect(progressText({ total: 28, checked: 12, needsLook: 2 })).toBe("12 of 28 checked · 2 need another look");
    expect(progressText({ total: 5, checked: 0, needsLook: 1 })).toBe("0 of 5 checked · 1 needs another look");
    expect(progressText({ total: 5, checked: 5, needsLook: 0 })).toBe("5 of 5 checked");
  });

  it("writes relative times", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(relativeTime("2026-10-11T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-10-11T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-10T12:00:00Z", now)).toBe("yesterday");
    expect(relativeTime("not a date", now)).toBe("");
  });

  it("links the live page by its token", () => {
    expect(liveLink("abc")).toBe("https://streettally.osm.lol/live/abc");
  });

  it("round-trips an event start through the local-time input", () => {
    const local = toLocalInput("2026-10-18T23:00:00Z");
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromLocalInput(local)).toBe("2026-10-18T23:00:00.000Z");
    expect(toLocalInput("not a date")).toBe("");
    expect(fromLocalInput("")).toBeUndefined();
    expect(fromLocalInput("2026-10-18")).toBeUndefined();
  });
});
