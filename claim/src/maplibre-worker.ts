import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// MapLibre 6 finds its worker next to its own module at runtime. Bundled, that file isn't there and the
// basemap stays blank ("Worker failed to load"), so we ship the worker as an asset and point at it.
setWorkerUrl(workerUrl);
