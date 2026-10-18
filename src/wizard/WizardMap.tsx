import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "../maplibre-worker";
import type { FeatureCollection, Polygon } from "geojson";
import { useEffect, useRef } from "react";
import type { Area, OpenFeature } from "./api";

/** A circle of `radius` metres as a 64-point polygon (close enough at city scale). */
function circle(a: Area): Polygon {
  const ring: [number, number][] = [];
  const dLat = a.radius / 111_320;
  const dLon = dLat / Math.cos((a.lat * Math.PI) / 180);
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * 2 * Math.PI;
    ring.push([a.lon + dLon * Math.cos(t), a.lat + dLat * Math.sin(t)]);
  }
  return { type: "Polygon", coordinates: [ring] };
}

const boundsOf = (a: Area): maplibregl.LngLatBoundsLike => {
  const [ring] = circle(a).coordinates;
  const b = new maplibregl.LngLatBounds();
  for (const p of ring) b.extend(p as [number, number]);
  return b;
};

const featureCollection = (features: OpenFeature[], leftOut: ReadonlySet<string>): FeatureCollection => ({
  type: "FeatureCollection",
  features: features.map((f) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [f.lon, f.lat] },
    properties: { id: f.id, out: leftOut.has(f.id) },
  })),
});

/**
 * The wizard's map: the area's circle (step 1, with a pin at the place), plus the open features with
 * left-out ones grey (step 3). Tapping a feature calls `onToggle`. The list beside it does the same
 * for keyboards, and `focused` rings the feature its pointer or focus is on.
 */
export function WizardMap({
  style,
  area,
  features = [],
  leftOut = new Set(),
  focused,
  onToggle,
  pin = false,
  label,
}: {
  style: string;
  area: Area;
  features?: OpenFeature[];
  leftOut?: ReadonlySet<string>;
  focused?: string;
  onToggle?: (id: string) => void;
  pin?: boolean;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map>(undefined);
  const ready = useRef(false);
  const toggle = useRef(onToggle);
  toggle.current = onToggle;
  const latest = useRef({ area, features, leftOut, focused, pin });
  latest.current = { area, features, leftOut, focused, pin };

  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style,
      bounds: boundsOf(latest.current.area),
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
      cooperativeGestures: true,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      const { area: a, features: f, leftOut: out, focused: on, pin: withPin } = latest.current;
      m.addSource("area", { type: "geojson", data: circle(a) });
      m.addLayer({ id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#f5a623", "fill-opacity": 0.12 } });
      m.addLayer({ id: "area-line", type: "line", source: "area", paint: { "line-color": "#14213d", "line-width": 2 } });
      m.addSource("features", { type: "geojson", data: featureCollection(f, out) });
      m.addLayer({
        id: "features",
        type: "circle",
        source: "features",
        paint: {
          "circle-radius": 6,
          "circle-color": ["case", ["get", "out"], "#9aa0a6", "#f5a623"],
          "circle-stroke-color": ["case", ["get", "out"], "#9aa0a6", "#14213d"],
          "circle-stroke-width": 2,
        },
      });
      // The ring for the list row under the pointer or focus.
      m.addLayer({
        id: "features-focused",
        type: "circle",
        source: "features",
        filter: ["==", ["get", "id"], on ?? ""],
        paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#14213d", "circle-stroke-width": 3 },
      });
      if (withPin) {
        m.addSource("place", { type: "geojson", data: { type: "Point", coordinates: [a.lon, a.lat] } });
        m.addLayer({
          id: "place",
          type: "circle",
          source: "place",
          paint: { "circle-radius": 7, "circle-color": "#14213d", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 },
        });
      }
      m.on("click", "features", (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (typeof id === "string") toggle.current?.(id);
      });
      m.on("mouseenter", "features", () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", "features", () => (m.getCanvas().style.cursor = ""));
      ready.current = true;
    });
    map.current = m;
    return () => {
      ready.current = false;
      m.remove();
    };
  }, [style]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("area") as maplibregl.GeoJSONSource | undefined)?.setData(circle(area));
    (m.getSource("place") as maplibregl.GeoJSONSource | undefined)?.setData({ type: "Point", coordinates: [area.lon, area.lat] });
    m.fitBounds(boundsOf(area), { padding: 24, duration: 300 });
  }, [area]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("features") as maplibregl.GeoJSONSource | undefined)?.setData(featureCollection(features, leftOut));
  }, [features, leftOut]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setFilter("features-focused", ["==", ["get", "id"], focused ?? ""]);
  }, [focused]);

  return <div className="wizard-map" ref={box} role="img" aria-label={label} />;
}
