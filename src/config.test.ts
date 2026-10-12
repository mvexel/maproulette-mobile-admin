import { describe, expect, it } from "vitest";
import { configure, inferEnvironment } from "./config";

describe("environment", () => {
  it.each([
    ["https://mr-prod.osm.lol", "prod"],
    ["https://mr-stage.osm.lol", "stage"],
    ["https://mr-api.osm.lol", "dev"],
    ["https://mr-dev.osm.lol", "dev"],
    ["http://127.0.0.1:9300", "dev"],
    ["http://localhost:9000", "dev"],
    ["https://maproulette.org", undefined],
    ["not a url", undefined],
  ])("infers %s as %s", (backend, environment) => {
    expect(inferEnvironment(backend)).toBe(environment);
  });

  it("prefers the configured environment over the host", () => {
    expect(configure({ backend: "https://mr-api.osm.lol", clientId: "c", environment: "stage" }).environment).toBe("stage");
  });

  it("rejects an unknown environment", () => {
    expect(() =>
      configure({ backend: "https://mr-api.osm.lol", clientId: "c", environment: "production" as never }),
    ).toThrow("dev, stage or prod");
  });

  it("takes the OpenStreetMap site from config, or from the environment", () => {
    expect(configure({ backend: "https://mr-stage.osm.lol", clientId: "c" }).osmWeb).toBe("https://www.openstreetmap.org");
    expect(configure({ backend: "https://mr-api.osm.lol", clientId: "c" }).osmWeb).toBe("https://master.apis.dev.openstreetmap.org");
    expect(configure({ backend: "https://mr-api.osm.lol", clientId: "c", osmWeb: "https://www.openstreetmap.org" }).osmWeb).toBe(
      "https://www.openstreetmap.org",
    );
    expect(() => configure({ backend: "https://mr-api.osm.lol", clientId: "c", osmWeb: "https://evil.example/x" })).toThrow("osmWeb");
  });
});
