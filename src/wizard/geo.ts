import type { MultiPolygon, Polygon } from "geojson";
import type { Area, Coverage } from "./api";

/** A circle of `radius` metres as a 64-point polygon (close enough at city scale). */
export function circle(a: Area): Polygon {
  const ring: [number, number][] = [];
  const dLat = a.radius / 111_320;
  const dLon = dLat / Math.cos((a.lat * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    ring.push([a.lon + dLon * Math.cos(t), a.lat + dLat * Math.sin(t)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

/** Even-odd ray casting over every ring, so holes count as outside. */
function inPolygon([x, y]: number[], rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

const inShape = (p: number[], shape: Polygon | MultiPolygon) =>
  shape.type === "Polygon" ? inPolygon(p, shape.coordinates) : shape.coordinates.some((poly) => inPolygon(p, poly));

/**
 * Whether the wizard can count features in `a` (W-EASY L2): the whole circle lies inside a fresh
 * extract's coverage. No extract, or a stale one, covers nothing: the backend's fallback (Overpass)
 * can't be reached from the server.
 */
export function covers(c: Coverage, a: Area): boolean {
  const x = c.extract;
  if (!x?.fresh) return false;
  const [w, s, e, n] = x.bbox;
  const ring = circle(a).coordinates[0];
  if (ring.some(([lon, lat]) => lon < w || lon > e || lat < s || lat > n)) return false;
  return [[a.lon, a.lat], ...ring].every((p) => inShape(p, x.coverage));
}
