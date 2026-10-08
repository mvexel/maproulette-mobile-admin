import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MockBackend } from "../mock/server.ts";
import { bboxArea, parseBoundary, parseRules, rulesFromMatch } from "./acquisition";
import { configure } from "./config";
import { cancelJob, createJob, getJob, getJobFeatures, isActive, type JobsError, listJobs } from "./jobs";
import { reset, setUp, signIn } from "./testing";

let mock: MockBackend;
beforeAll(async () => {
  mock = await setUp();
  configure({ backend: mock.url, clientId: "maproulette-mobile-admin", jobs: mock.url });
});
afterAll(() => mock.close());
beforeEach(async () => {
  reset(mock);
  await signIn(mock);
});

const input = (name = "Test") => ({ name, region: { type: "bbox" as const, bbox: [40.7, -111.9, 40.8, -111.8] as [number, number, number, number] }, rules: [{ amenity: "restaurant" }] });
const failure = (p: Promise<unknown>) => p.then(() => expect.fail("expected a rejection")).catch((e: unknown) => e as JobsError);

describe("jobs client", () => {
  it("queues, progresses to complete and returns features", async () => {
    const job = await createJob(input());
    expect(job.state).toBe("queued");
    let cur = job;
    for (let i = 0; i < 10 && isActive(cur.state); i++) cur = await getJob(job.id);
    expect(cur.state).toBe("complete");
    expect(cur.result?.featureCount).toBe(3);
    expect((await listJobs())[0].id).toBe(job.id);
    expect((await getJobFeatures(job.id)).features).toHaveLength(3);
  });
  it("reports failures and refuses features before completion", async () => {
    const job = await createJob(input("x [fail]"));
    expect((await failure(getJobFeatures(job.id))).status).toBe(409);
    let cur = job;
    for (let i = 0; i < 10 && isActive(cur.state); i++) cur = await getJob(job.id);
    expect(cur).toMatchObject({ state: "failed", error: { code: "too_large" } });
  });
  it("cancels and expires", async () => {
    const a = await createJob(input());
    expect((await cancelJob(a.id)).state).toBe("cancelled");
    const b = await createJob(input());
    for (let i = 0; i < 6; i++) await getJob(b.id);
    await fetch(`${mock.url}/__mock/jobs/expire`, { method: "POST" });
    expect((await failure(getJobFeatures(b.id))).status).toBe(410);
  });
  it("validates and caps active jobs", async () => {
    const bad = await failure(createJob({ ...input(), rules: [] }));
    expect([bad.status, bad.code]).toEqual([422, "invalid_request"]);
    await createJob(input()); await createJob(input()); await createJob(input());
    expect((await failure(createJob(input()))).status).toBe(429);
  });
  it("does not resend a POST after a failed network call", async () => {
    configure({ backend: mock.url, clientId: "maproulette-mobile-admin", jobs: "http://127.0.0.1:1" });
    await expect(createJob(input())).rejects.toThrow();
    configure({ backend: mock.url, clientId: "maproulette-mobile-admin", jobs: mock.url });
    expect(await listJobs()).toEqual([]);
  });
  it("refreshes an expired token once", async () => {
    mock.expireAccess();
    expect(await listJobs()).toEqual([]);
  });
});

describe("area and rules", () => {
  const square = { type: "Polygon", coordinates: [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]] };
  it("accepts polygon shapes and merges collections", () => {
    expect(parseBoundary(JSON.stringify(square)).region.type).toBe("geojson");
    const fc = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: square }, { type: "Feature", properties: {}, geometry: square }] };
    const a = parseBoundary(JSON.stringify(fc));
    expect(a.region).toMatchObject({ geometry: { type: "MultiPolygon" } });
    expect(a.vertices).toBe(10);
  });
  it("rejects bad boundaries and warns on large areas", () => {
    expect(() => parseBoundary("nope")).toThrow(/valid JSON/);
    expect(() => parseBoundary(JSON.stringify({ type: "Point", coordinates: [0, 0] }))).toThrow(/Unsupported/);
    expect(() => parseBoundary(JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }))).toThrow(/closed/);
    const ring = Array.from({ length: 5001 }, (_, i) => [i / 1e5, 0]); ring.push(ring[0]);
    expect(() => parseBoundary(JSON.stringify({ type: "Polygon", coordinates: [ring] }))).toThrow(/vertices/);
    const big = parseBoundary(JSON.stringify({ type: "Polygon", coordinates: [[[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]] }));
    expect(big.warnings).toHaveLength(1);
  });
  it("validates bounding boxes", () => {
    expect(bboxArea(["", "1", "2", "3"])).toEqual(["South must be a number"]);
    expect(bboxArea(["5", "0", "1", "1"])).toContain("South must be less than north");
    const ok = bboxArea(["40", "-112", "40.1", "-111.9"]);
    expect(Array.isArray(ok)).toBe(false);
    expect(Array.isArray(ok) ? 0 : ok.warnings).toEqual([]);
  });
  it("derives and parses rules", () => {
    expect(rulesFromMatch({ amenity: "restaurant" })).toEqual(["amenity=restaurant"]);
    expect(parseRules(["amenity=restaurant\ncuisine=*", "shop=bakery"]).rules).toEqual([{ amenity: "restaurant", cuisine: "*" }, { shop: "bakery" }]);
    expect(parseRules(["oops"]).problems.length).toBeGreaterThan(0);
    expect(parseRules([""]).problems).toEqual(["Add at least one rule"]);
  });
});
