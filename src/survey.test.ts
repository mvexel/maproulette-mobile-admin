import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { exampleSurvey, generateTasks, parseSurvey } from "./survey";

describe("existing-contract survey generator", () => {
  it.each(["restaurant", "bus-stop"] as const)("generates deterministic %s tasks with typed feature identity", kind => {
    const s = exampleSurvey(kind);
    const generated = generateTasks(s);
    expect(generated).toEqual(generateTasks(JSON.parse(JSON.stringify(s))));
    const task = JSON.parse(generated.text);
    expect(task.features[0].properties["@id"]).toBe(task.cooperativeWork.element);
    expect(task.cooperativeWork.meta).toEqual({ version: 2, type: 3, choiceVersion: 1 });
    expect(task.cooperativeWork.liveMissingQuestions).toBe(true);
    expect(task.cooperativeWork.questions).toEqual(s.questions);
    expect(generated.text).toBe(readFileSync(new URL(`../examples/${kind}-tasks.geojsonl`, import.meta.url), "utf8"));
  });
  it("offers only absent restaurant tags, and reports fully known or mismatched features", () => {
    const s = exampleSurvey("restaurant");
    const original = s.features.features[0];
    original.properties.outdoor_seating = "yes";
    s.features.features.push({ ...original, properties: { ...original.properties, "@id": "way/2", takeaway: "yes", delivery: "no", toilets: "yes" } });
    s.features.features.push({ ...original, properties: { "@id": "relation/3", amenity: "cafe" } });
    const g = generateTasks(s);
    expect(g.count).toBe(1);
    expect(JSON.parse(g.text).cooperativeWork.questions.map((q: { id: string }) => q.id)).toEqual(["takeaway", "delivery", "toilets"]);
    expect(g.skipped).toEqual(["way/2: no applicable questions", "relation/3: identity tags do not match"]);
  });
  it("supports exact-value guards without declaring missing-tag mode", () => {
    const s = exampleSurvey("bus-stop");
    s.questions[0].expect.shelter = "unknown";
    s.features.features[0].properties.shelter = "unknown";
    expect(JSON.parse(generateTasks(s).text).cooperativeWork.liveMissingQuestions).toBeUndefined();
  });
  it("carries campaign outcomes into every task, and leaves them out when there are none", () => {
    const s = exampleSurvey("bus-stop");
    expect(JSON.parse(generateTasks(s).text).cooperativeWork.outcomes).toBeUndefined();
    s.outcomes = [{ id: "no-door", label: "There's no door", description: "It's an open doorway or a gate.", status: 6 }];
    expect(JSON.parse(generateTasks(s).text).cooperativeWork.outcomes).toEqual(s.outcomes);
  });
  it("matches each task on its own feature's value for matchKeys, and leaves out features without the key", () => {
    const s = exampleSurvey("bus-stop");
    s.match = {};
    s.matchKeys = ["highway"];
    const base = s.features.features[0];
    s.features.features.push({ ...base, properties: { "@id": "node/2", highway: "platform" } }, { ...base, properties: { "@id": "node/3" } });
    const g = generateTasks(s);
    expect(g.text.trim().split("\n").map(l => JSON.parse(l).cooperativeWork.match)).toEqual([{ highway: "bus_stop" }, { highway: "platform" }]);
    expect(g.skipped).toEqual(["node/3: no highway tag to match"]);
  });
  it.each([
    ["a matchKey that is also in match", { matchKeys: ["highway"] }],
    ["a matchKey a question guards", { match: {}, matchKeys: ["shelter"] }],
    ["more than 4 identity tags", { match: { a: "1", b: "2", c: "3" }, matchKeys: ["d", "e"] }],
  ])("rejects %s", (_, change) => {
    expect(() => parseSurvey({ ...exampleSurvey("bus-stop"), ...change })).toThrow();
  });
  it.each([
    ["a built-in outcome", [{ id: "not-here", label: "Gone", status: 6 }]],
    ["an outcome status other than 2 or 6", [{ id: "no-door", label: "There's no door", status: 5 }]],
    ["duplicate outcome IDs", [{ id: "a", label: "A", status: 2 }, { id: "a", label: "B", status: 6 }]],
    ["more than 4 outcomes", ["a", "b", "c", "d", "e"].map(id => ({ id, label: id, status: 6 }))],
    ["an outcome that deletes", [{ id: "gone", label: "Gone", delete: true }]],
  ])("rejects %s", (_, outcomes) => {
    expect(() => parseSurvey({ ...exampleSurvey("bus-stop"), outcomes })).toThrow();
  });
  it.each([
    ["duplicate feature IDs", (s: ReturnType<typeof exampleSurvey>) => s.features.features.push(s.features.features[0])],
    ["overlapping guarded keys", (s: ReturnType<typeof exampleSurvey>) => s.questions.push({ ...s.questions[0], id: "duplicate" })],
    ["unguarded edits", (s: ReturnType<typeof exampleSurvey>) => { s.questions[0].options[0].setTags = { name: "wrong" }; }],
    ["identity guard overlap", (s: ReturnType<typeof exampleSurvey>) => { s.match.shelter = "yes"; }],
    ["no-op answer", (s: ReturnType<typeof exampleSurvey>) => { s.questions[0].expect.shelter = "yes"; }],
    ["bad coordinate", (s: ReturnType<typeof exampleSurvey>) => { s.features.features[0].geometry.coordinates[0] = 181; }],
    ["ambiguous feature ID", (s: ReturnType<typeof exampleSurvey>) => { s.features.features[0].properties["@id"] = "123"; }],
    ["newline in question ID", (s: ReturnType<typeof exampleSurvey>) => { s.questions[0].id += "\n"; }],
    ["newline in feature ID", (s: ReturnType<typeof exampleSurvey>) => { s.features.features[0].properties["@id"] += "\n"; }],
    ["unsupported schema", (s: ReturnType<typeof exampleSurvey>) => Object.assign(s, { version: 2 })],
  ])("rejects %s before import", (_, change) => {
    const s = exampleSurvey("bus-stop"); change(s);
    expect(() => parseSurvey(s)).toThrow();
  });
  it("rejects malformed question/feature structures with validation errors", () => {
    for (const value of [null, [], {}, { ...exampleSurvey("restaurant"), questions: [null] }, { ...exampleSurvey("restaurant"), features: { type: "FeatureCollection", features: [null] } }]) expect(() => parseSurvey(value)).toThrow();
  });
  it("enforces the actual UTF-8 payload limit after feature filtering", () => {
    const s = exampleSurvey("restaurant");
    s.questions[0].options = Array.from({ length: 12 }, (_, i) => ({ id: `answer-${i}`, label: "😀".repeat(60), description: "😀".repeat(300), setTags: { outdoor_seating: "yes" } }));
    expect(() => generateTasks(s)).toThrow(/16 KiB/);
  });
});
