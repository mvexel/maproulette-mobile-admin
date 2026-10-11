import { describe, expect, it } from "vitest";
import { canPublish, publishChecks, type PublishInput } from "./publish";

const good: PublishInput = {
  report: { created: 3, updated: 0, rejected: 0, expected: 3 },
  project: { name: "SLC test", enabled: true },
  checkinComment: "Street Tally: bus stop details #StreetTallySLC",
  checkinSource: "survey",
  description: "Check the bus stops near you.",
  writesEnabled: false,
  environment: "stage",
};
const kinds = (input: PublishInput) => Object.fromEntries(publishChecks(input).map((c) => [c.id, c.kind]));

describe("publish checks", () => {
  it("pass a clean campaign, with the writes notice for the environment", () => {
    const checks = publishChecks(good);
    expect(kinds(good)).toEqual({ import: "pass", project: "pass", hashtag: "pass", source: "pass", description: "pass", writes: "info" });
    expect(checks.find((c) => c.id === "writes")?.text).toContain("off on STAGE");
    expect(canPublish(checks, new Set())).toBe(true);
  });

  it("block rejected lines and an off project, with a fix for the project", () => {
    const input = { ...good, report: { created: 1, updated: 0, rejected: 2, expected: 3 }, project: { name: "SLC test", enabled: false } };
    const checks = publishChecks(input);
    expect(checks.find((c) => c.id === "import")?.text).toBe("2 lines were rejected. Fix them before publishing.");
    expect(checks.find((c) => c.id === "project")).toMatchObject({ kind: "block", fix: "turn-on-project" });
    expect(canPublish(checks, new Set(["hashtag", "source", "description"]))).toBe(false);
  });

  it("block updated lines too", () => {
    expect(kinds({ ...good, report: { created: 2, updated: 1, rejected: 0, expected: 3 } }).import).toBe("block");
  });

  it("warn about a missing hashtag, another source, and links or timing in the description", () => {
    for (const description of ["See https://example.org", "About 2 minutes per stop", "Takes 5-10 min", "[map](x)"]) {
      const input = { ...good, checkinComment: "Bus stops", checkinSource: "local knowledge", description };
      expect(kinds(input)).toMatchObject({ hashtag: "warning", source: "warning", description: "warning" });
      const checks = publishChecks(input);
      expect(canPublish(checks, new Set(["hashtag", "source"]))).toBe(false);
      expect(canPublish(checks, new Set(["hashtag", "source", "description"]))).toBe(true);
    }
  });

  it("say so in bold on production and when writes are on", () => {
    const checks = publishChecks({ ...good, environment: "prod", writesEnabled: true });
    expect(checks.find((c) => c.id === "prod")).toMatchObject({ kind: "info", strong: true });
    expect(checks.find((c) => c.id === "writes")?.text).toContain("answers will edit OpenStreetMap");
  });

  it("leave out the import check on the campaign page", () => {
    expect(kinds({ ...good, report: undefined }).import).toBeUndefined();
  });
});
