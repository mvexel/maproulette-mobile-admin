import { describe, expect, it } from "vitest";
import { QUESTION_SETS } from "../../mock/server.ts";
import type { QuestionSet, SetCount } from "./api";
import { bySetCount, changesetComment, checkLine, countLine, distance, draftDescription, draftName, hashtag, inviteText, paceHint, pickable } from "./words";

const doors = QUESTION_SETS[0] as QuestionSet;
const count = (set: string, open: number, complete = 0): SetCount => ({ set, version: 1, open, complete });

describe("wizard words", () => {
  it("writes distances and count lines", () => {
    expect(distance(400)).toBe("400 m");
    expect(distance(1200)).toBe("1.2 km");
    expect(distance(3000)).toBe("3 km");
    expect(countLine(undefined)).toBe("Counting…");
    expect(countLine(count("x", 23))).toBe("23 to check here");
    expect(countLine(count("x", 0))).toBe("Nothing to check here");
    expect(countLine({ set: "x", version: 1, unavailable: true })).toBe("Count not available");
  });

  it("sorts cards by count, keeps unavailable ones pickable and empty ones last", () => {
    const sets = QUESTION_SETS as QuestionSet[];
    const counts = new Map<string, SetCount>([
      ["entrance-doors", count("entrance-doors", 23)],
      ["crossings", count("crossings", 40)],
      ["bus-stops", count("bus-stops", 6)],
      ["benches", count("benches", 0)],
      ["trees", { set: "trees", version: 1, unavailable: true }],
    ]);
    expect(bySetCount(sets, counts).map((s) => s.id)).toEqual(["crossings", "entrance-doors", "bus-stops", "trees", "benches"]);
    expect(pickable(counts.get("trees"))).toBe(true);
    expect(pickable(counts.get("benches"))).toBe(false);
    expect(pickable(undefined)).toBe(true);
  });

  it("warns about a long evening without blocking", () => {
    expect(paceHint(500, doors)).toBeUndefined();
    expect(paceHint(1200, doors)).toBe("About 4 hours for 10 people. It can stay open after the event.");
  });

  it("drafts the step 3 line, the name and the description", () => {
    expect(checkLine(23, 41, doors)).toBe("23 entrances to check. 41 are already complete, so we left them out.");
    expect(checkLine(1, 1, doors)).toBe("1 entrance to check. 1 is already complete, so we left them out.");
    expect(checkLine(5, 0, doors)).toBe("5 entrances to check.");
    expect(draftName(doors, "Woodbine Food Hall")).toBe("Entrance doors around Woodbine Food Hall");
    expect(draftDescription(doors, "Woodbine Food Hall")).toBe(
      "Help map the entrances around Woodbine Food Hall, so wheelchair, stroller and walker users know what to expect.",
    );
  });

  it("derives the hashtag, the changeset comment and the invite", () => {
    expect(hashtag("Woodbine Food Hall")).toBe("#StreetTallyWoodbineFoodHall");
    expect(hashtag("Café São Paulo, 5th st.")).toBe("#StreetTallyCafeSaoPaulo5thSt");
    expect(hashtag("x".repeat(80))).toHaveLength(40);
    expect(changesetComment("Entrance doors around Woodbine", "#StreetTallyWoodbine")).toBe(
      "From a Street Tally survey for Entrance doors around Woodbine. Checked by me. #StreetTally #StreetTallyWoodbine",
    );
    expect(inviteText(doors, "Woodbine Food Hall", "https://x.test/c/1", "2026-11-10")).toBe(
      "Join us at Woodbine Food Hall on 10 November 2026 to check entrances for Street Tally. No account needed, just your phone: https://x.test/c/1",
    );
  });
});
