import { describe, expect, it } from "vitest";
import { challengeFor, randomString } from "./pkce";

describe("pkce", () => {
  it("matches the RFC 7636 S256 example", async () => {
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("generates url-safe verifiers", () => {
    expect(randomString(48)).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
});
