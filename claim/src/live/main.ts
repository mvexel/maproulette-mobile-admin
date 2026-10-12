import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { config, loadConfig } from "../config";
import { fetchLive, type LivePage, type LiveStop, tokenFrom } from "./api";
import "./live.css";
import { label, type Noun, noun, recent, STATE_LABEL, subLine, tallyLine, when } from "./words";

/**
 * The live progress page (BACKLOG #12, design/live-progress.md, Juno's mock brand/progress/, Iris's
 * review design/live-progress-review.md). Link-only: /live/<token>. Polls every 30 s while the tab
 * is visible. Everything from the server is set as text, never as HTML.
 */

const POLL_MS = 30_000;
const HIT = 22; // px: a 44 × 44 hit area around each marker (review L2)
const PHONE = window.matchMedia("(max-width: 640px)");

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const stage = $("stage");
const card = $("card");
const fresh = $("fresh");

let page: LivePage | undefined;
let fetchedAt = 0; // Date.now() of the last good response
let failing = false;
let map: maplibregl.Map | undefined;
const markers = new Map<number, { marker: maplibregl.Marker; el: HTMLButtonElement; stop: LiveStop }>();
let selected: number | undefined;
let fitted = false;
let n: Noun = { one: "place", many: "places" };

function message(title: string, body: string) {
  for (const id of ["header", "stage", "footer"]) $(id).hidden = true;
  $("message").hidden = false;
  $("msgTitle").textContent = title;
  $("msgBody").textContent = body;
}

function renderHeader(p: LivePage) {
  document.title = `${p.campaign.name} · Street Tally`;
  $("campaign").textContent = p.campaign.name;
  const line = tallyLine(p, n);
  $("checked").textContent = String(line.checked);
  $("of").textContent = line.rest;
  $("sub").textContent = subLine(p);
  $("barfill").style.width = `${p.tally.total ? (100 * p.tally.checked) / p.tally.total : 0}%`;
  $("legendJust").hidden = p.mode !== "live";
}

function renderFooter(p: LivePage) {
  const footer = $("footer");
  const osm = document.createElement("a");
  osm.href = "https://www.openstreetmap.org/about";
  osm.textContent = "OpenStreetMap";
  footer.replaceChildren(
    `This ${map ? "map" : "page"} shows which ${n.many} volunteers checked for ${p.campaign.name}. It doesn't show who checked them. Each volunteer adds their answers to `,
    osm,
    ", the free, open map, under their own account.",
    ...(p.campaign.hashtags.length ? [` · ${p.campaign.hashtags.join(" ")}`] : []),
  );
}

function renderFresh() {
  if (!page || page.mode === "ended") {
    fresh.hidden = true;
    return;
  }
  fresh.hidden = false;
  fresh.classList.toggle("bad", failing);
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  const secs = Math.round((Date.now() - fetchedAt) / 1000);
  const text = failing
    ? `Last updated ${secs < 90 ? `${secs} s` : `${Math.round(secs / 60)} min`} ago, reconnecting`
    : `Live · updated ${secs < 5 ? "just now" : `${secs} s ago`}`;
  fresh.replaceChildren(dot, text);
}

/** A marker: a focusable button, sized by CSS in pixels, so it keeps its size at any zoom. */
function markerElement(stop: LiveStop, p: LivePage): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `pin ${stop.state}`;
  el.classList.toggle("just", recent(stop, p));
  el.classList.toggle("selected", stop.id === selected);
  el.setAttribute("aria-label", `${label(stop, n)}, ${STATE_LABEL[stop.state]}`);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCard(stop.id);
    }
  });
  return el;
}

function renderMarkers(p: LivePage) {
  if (!map) return;
  const seen = new Set<number>();
  for (const stop of p.stops) {
    seen.add(stop.id);
    const el = markerElement(stop, p);
    const existing = markers.get(stop.id);
    if (existing) {
      existing.el.replaceWith(el);
      existing.marker.remove();
    }
    const marker = new maplibregl.Marker({ element: el }).setLngLat([stop.lon, stop.lat]).addTo(map);
    markers.set(stop.id, { marker, el, stop });
  }
  for (const [id, m] of markers) {
    if (!seen.has(id)) {
      m.marker.remove();
      markers.delete(id);
    }
  }
  if (!fitted && p.stops.length) {
    fitted = true;
    const bounds = new maplibregl.LngLatBounds();
    for (const s of p.stops) bounds.extend([s.lon, s.lat]);
    map.fitBounds(bounds, { padding: 56, maxZoom: 17, animate: false });
    // Phones start one zoom level closer (review L2).
    if (PHONE.matches) map.setZoom(Math.min(map.getZoom() + 1, 18));
  }
}

/** Without a map style (or before MapLibre loads), the same stops as a plain list. */
function renderList(p: LivePage) {
  const list = $("list");
  list.hidden = false;
  list.replaceChildren(
    ...p.stops.map((stop) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = `row ${stop.state}`;
      const mk = document.createElement("span");
      mk.className = `mk ${stop.state}`;
      mk.setAttribute("aria-hidden", "true");
      b.append(mk, `${label(stop, n)}: ${STATE_LABEL[stop.state]}`);
      b.addEventListener("click", () => openCard(stop.id));
      li.append(b);
      return li;
    }),
  );
}

function openCard(id: number) {
  const stop = page?.stops.find((s) => s.id === id);
  if (!page || !stop) return;
  selected = id;
  const close = document.createElement("button");
  close.className = "x";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close");
  close.onclick = () => closeCard();
  const h = document.createElement("h3");
  h.id = "cardTitle";
  h.tabIndex = -1;
  h.textContent = label(stop, n);
  const st = document.createElement("div");
  st.className = `state ${stop.state}`;
  st.textContent = STATE_LABEL[stop.state];
  card.replaceChildren(close, h, st);
  const time = when(stop, page, Date.now() - fetchedAt);
  if (time) {
    const w = document.createElement("div");
    w.className = "when";
    w.textContent = time;
    card.append(w);
  }
  if (stop.reported) {
    const r = document.createElement("div");
    r.className = "outcome";
    r.textContent = `Reported: ${stop.reported}`;
    card.append(r);
  } else if (stop.answers?.length) {
    const dl = document.createElement("dl");
    for (const a of stop.answers) {
      const dt = document.createElement("dt");
      dt.textContent = a.question;
      const dd = document.createElement("dd");
      dd.textContent = a.answer;
      dl.append(dt, dd);
    }
    card.append(dl);
  }
  card.hidden = false;
  for (const [mid, m] of markers) m.el.classList.toggle("selected", mid === id);
  placeCard(stop);
  h.focus();
}

function closeCard() {
  if (card.hidden) return;
  const id = selected;
  card.hidden = true;
  selected = undefined;
  for (const m of markers.values()) m.el.classList.remove("selected");
  if (id !== undefined) markers.get(id)?.el.focus();
}

/**
 * Desktop: beside its stop, flipped to stay on screen, never over it (review L1). Phone: docked at
 * the bottom by CSS, and the map eases so the stop sits above the card.
 */
function placeCard(stop: LiveStop) {
  if (!map) return;
  if (PHONE.matches) {
    card.style.left = card.style.top = "";
    const lift = card.offsetHeight / 2 + 8;
    map.easeTo({ center: [stop.lon, stop.lat], offset: [0, -lift], duration: 300 });
    return;
  }
  const pt = map.project([stop.lon, stop.lat]);
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const gap = 28;
  let left = pt.x + gap;
  if (left + cw > W - 12) left = pt.x - gap - cw;
  const top = Math.min(Math.max(pt.y - ch / 2, 12), H - ch - 12);
  card.style.left = `${Math.max(12, left)}px`;
  card.style.top = `${Math.max(12, top)}px`;
}

/** One click handler for the map: the nearest stop within the hit radius wins (review L2). */
function nearest(point: maplibregl.Point): number | undefined {
  if (!map || !page) return undefined;
  let best: number | undefined;
  let bd = HIT * HIT;
  for (const s of page.stops) {
    const p = map.project([s.lon, s.lat]);
    const d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2;
    if (d <= bd) {
      bd = d;
      best = s.id;
    }
  }
  return best;
}

function startMap(style: string) {
  map = new maplibregl.Map({
    container: "map",
    style,
    center: [0, 0],
    zoom: 1,
    attributionControl: { compact: true },
    dragRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.on("click", (e) => {
    const id = nearest(e.point);
    if (id === undefined) closeCard();
    else openCard(id);
  });
  map.on("move", () => {
    const stop = page?.stops.find((s) => s.id === selected);
    if (stop && !card.hidden && !PHONE.matches) placeCard(stop);
  });
}

function show(p: LivePage) {
  page = p;
  n = noun(p.campaign.match ?? {});
  $("message").hidden = true;
  for (const id of ["header", "stage", "footer"]) $(id).hidden = false;
  renderHeader(p);
  renderFooter(p);
  if (map) renderMarkers(p);
  else renderList(p);
  if (selected !== undefined && !card.hidden) {
    if (p.stops.some((s) => s.id === selected)) openCard(selected);
    else closeCard();
  }
  renderFresh();
}

async function refresh(token: string) {
  const result = await fetchLive(token);
  if ("page" in result) {
    fetchedAt = Date.now();
    failing = false;
    show(result.page);
  } else if (result.problem === "missing") {
    message("This link doesn't work", "It may have been replaced with a new one. Ask the organizer for the current link.");
  } else if (result.problem === "off") {
    message("This page is turned off", "The organizer has turned off the live map for this campaign.");
  } else if (page) {
    failing = true;
    renderFresh();
  } else {
    message("The live map can't load right now", "Check your connection. The page tries again every 30 seconds.");
  }
  return result;
}

async function boot() {
  const token = tokenFrom(location.pathname);
  if (!token) {
    message("This link doesn't work", "It may have been replaced with a new one. Ask the organizer for the current link.");
    return;
  }
  try {
    await loadConfig();
  } catch {
    message("This page isn't set up yet", "config.json is missing or invalid.");
    return;
  }
  if (config().mapStyle) startMap(config().mapStyle);
  else {
    $("map").hidden = true;
    document.body.classList.add("list-mode");
  }
  const first = await refresh(token);
  if ("problem" in first && first.problem !== "error") return;
  // Poll while visible; pause when hidden, and refresh at once when the tab comes back.
  setInterval(() => {
    if (!document.hidden && page?.mode !== "ended") void refresh(token);
  }, POLL_MS);
  setInterval(() => {
    if (!document.hidden) renderFresh();
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - fetchedAt >= POLL_MS) void refresh(token);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCard();
  });
}

void boot();
