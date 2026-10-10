import { useEffect, useRef } from "react";
import type { Preview } from "./api";
import { config } from "./config";

/**
 * The participant's stops on an OpenFreeMap base map (MapLibre, loaded on demand). With no
 * `mapStyle` configured (tests, or a deployment without tiles) it renders nothing; the list
 * under it still shows every stop.
 */
export function StopMap({ tasks }: { tasks: Preview["tasks"] }) {
  const el = useRef<HTMLDivElement>(null);
  const style = config().mapStyle;

  useEffect(() => {
    if (!style || !el.current || tasks.length === 0) return;
    let map: { remove(): void } | undefined;
    let cancelled = false;
    import("./maplibre").then(({ showStops }) => {
      if (!cancelled && el.current) map = showStops(el.current, style, tasks);
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [style, tasks]);

  if (!style || tasks.length === 0) return null;
  return <div ref={el} className="map" role="img" aria-label="Map of the places you checked" />;
}
