import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import "./maplibre-worker";
import type { Preview } from "./api";

/** Draws the stops as signal-color pins and fits the map to them. Tapping a pin shows its answers. */
export function showStops(container: HTMLElement, style: string, tasks: Preview["tasks"]) {
  const bounds = new maplibregl.LngLatBounds();
  for (const t of tasks) bounds.extend([t.lon, t.lat]);
  const map = new maplibregl.Map({
    container,
    style,
    bounds,
    fitBoundsOptions: { padding: 48, maxZoom: 16 },
    attributionControl: { compact: true },
    cooperativeGestures: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("load", () => {
    map.addSource("stops", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: tasks.map((t) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [t.lon, t.lat] },
          properties: { taskId: t.taskId },
        })),
      },
    });
    map.addLayer({
      id: "stops",
      type: "circle",
      source: "stops",
      paint: { "circle-radius": 8, "circle-color": "#F5A524", "circle-stroke-color": "#14213D", "circle-stroke-width": 2.5 },
    });
    map.on("click", "stops", (e) => {
      const id = e.features?.[0]?.properties?.taskId as number | undefined;
      const t = tasks.find((x) => x.taskId === id);
      if (!t) return;
      // Built with DOM nodes, not HTML strings: labels and answers come from the server.
      const body = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = t.label ?? `Place ${t.taskId}`;
      body.append(name);
      for (const a of t.answers ?? []) {
        const line = document.createElement("div");
        line.textContent = `${a.prompt} ${a.label}`;
        body.append(line);
      }
      new maplibregl.Popup({ closeButton: true }).setLngLat([t.lon, t.lat]).setDOMContent(body).addTo(map);
    });
    map.on("mouseenter", "stops", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "stops", () => {
      map.getCanvas().style.cursor = "";
    });
  });
  return map;
}
