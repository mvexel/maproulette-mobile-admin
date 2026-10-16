import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { config, loadConfig } from "../config";
import { label, type Noun, noun } from "../live/words";
import { fetchReview, MarkError, mark, type ReviewPage, type ReviewPlace, tokenFrom } from "./api";
import "./review.css";
import { accessToken, completeSignIn, displayName, rememberedToken, rememberToken, SignInError, signedIn, signOut, startSignIn } from "./session";
import {
  changesetComment,
  countsLine,
  currentLine,
  type Filter,
  idUrl,
  josmUrl,
  needsLook,
  reportText,
  shown,
  stateLabel,
  tagText,
  whoLine,
} from "./words";

/**
 * The review page for local mappers (design/handback-copy.md §2, SPRINT 3 H2): /review/<token>,
 * with the campaign's live page token. Evidence per place, Open in JOSM or iD, and two marks, Skip
 * (for you only) and Needs a visit. There's no Accept, and nothing uploads from here: mappers add
 * tags in their own editor, and the server marks a place done once OSM has them. Everything from the
 * server is set as text, never as HTML.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let token = "";
let page: ReviewPage | undefined;
let filter: Filter = "all";
let showSkipped = false;
let selected: number | undefined;
let map: maplibregl.Map | undefined;
let n: Noun = { one: "place", many: "places" };

function message(title: string, body: string) {
  for (const id of ["header", "stage", "footer"]) $(id).hidden = true;
  $("message").hidden = false;
  $("msgTitle").textContent = title;
  $("msgBody").textContent = body;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderAccount() {
  const box = $("account");
  if (signedIn()) {
    const out = el("button", "link", "Sign out");
    out.type = "button";
    out.onclick = async () => {
      await signOut();
      await load();
    };
    box.replaceChildren(el("span", "", `Signed in as ${displayName() ?? "you"}`), " · ", out);
  } else {
    const b = el("button", "signin", "Sign in with OpenStreetMap");
    b.type = "button";
    b.onclick = () => void startSignIn();
    box.replaceChildren(b, el("span", "hint", "To skip or mark places. Read-only: it can't edit the map."));
  }
}

function renderHeader(p: ReviewPage) {
  document.title = `Review · ${p.campaign.name} · Street Tally`;
  $("campaign").textContent = p.campaign.name;
  $("counts").textContent = countsLine(p);
  $("comment").textContent = changesetComment(p);
}

/** JOSM listens on localhost; the request only tells it what to load. */
async function openInJosm(p: ReviewPlace, note: HTMLElement) {
  note.textContent = "";
  try {
    await fetch(josmUrl(p), { mode: "no-cors", credentials: "omit", cache: "no-store" });
  } catch {
    note.textContent = "JOSM didn't answer. Start JOSM and turn on Remote Control in its preferences.";
  }
}

async function setMark(p: ReviewPlace, what: "skip" | "needs-visit", on: boolean, note: HTMLElement) {
  if (!signedIn()) {
    await startSignIn();
    return;
  }
  note.textContent = "";
  try {
    await mark(token, p.id, what, on, await accessToken());
    await load();
  } catch (e) {
    if (e instanceof SignInError || (e instanceof MarkError && e.status === 401)) {
      note.textContent = "Your sign-in has ended. Sign in again to mark places.";
      renderAccount();
    } else note.textContent = "That didn't save. Try again.";
  }
}

function button(text: string, onclick: () => void, cls = "act"): HTMLButtonElement {
  const b = el("button", cls, text);
  b.type = "button";
  b.onclick = onclick;
  return b;
}

function placeRow(p: ReviewPlace, osmWeb: string): HTMLElement {
  const row = el("article", `place ${p.state}`);
  row.id = `place-${p.id}`;
  row.classList.toggle("selected", p.id === selected);
  const head = el("div", "head");
  const h = el("h2", "", label(p, n));
  h.id = `place-${p.id}-title`;
  row.setAttribute("aria-labelledby", h.id);
  head.append(h);
  const st = stateLabel(p);
  if (st) head.append(el("span", `chip ${p.state === "open" ? "look" : p.state}`, st));
  if (map) head.append(button("Show on map", () => select(p.id, true), "where"));
  row.append(head);

  const ev = el("ul", "evidence");
  for (const s of p.suggestions) {
    const li = el("li");
    li.append(el("div", "q", s.question));
    const a = el("div", "a");
    a.append(el("b", "", s.answer), " ", el("code", "", tagText(s.tags)));
    li.append(a, el("div", "meta", `${whoLine(s)} · ${currentLine(s)}`));
    ev.append(li);
  }
  for (const r of p.reports) ev.append(el("li", "report", `${reportText(r)} · ${whoLine(r)}`));
  row.append(ev);

  const note = el("p", "note");
  note.setAttribute("role", "status");
  const actions = el("div", "actions");
  actions.append(button("Open in JOSM", () => void openInJosm(p, note)));
  const id = el("a", "act", "Open in iD");
  id.href = idUrl(p, osmWeb);
  id.target = "_blank";
  id.rel = "noopener noreferrer";
  actions.append(id);
  if (p.state !== "done") {
    actions.append(
      p.skipped ? button("Undo skip", () => void setMark(p, "skip", false, note)) : button("Skip", () => void setMark(p, "skip", true, note)),
      p.state === "needs_visit"
        ? button("Undo visit", () => void setMark(p, "needs-visit", false, note))
        : button("Needs a visit", () => void setMark(p, "needs-visit", true, note)),
    );
  }
  row.append(actions, note);
  if (needsLook(p) && p.state === "open") row.append(el("p", "hint", "Not a tag change. Look at it on the ground or on imagery first."));
  return row;
}

function renderPlaces(p: ReviewPage) {
  const osmWeb = config().osmWeb;
  const skipped = p.places.filter((x) => x.skipped && x.state !== "done");
  const list = p.places.filter((x) => shown(x, filter) && (showSkipped || !x.skipped || x.state === "done"));
  $("places").replaceChildren(...list.map((x) => placeRow(x, osmWeb)));
  $("empty").hidden = list.length > 0;
  const s = $("skipped");
  s.hidden = skipped.length === 0;
  if (skipped.length) {
    const t = button(showSkipped ? "Hide them" : "Show them", () => {
      showSkipped = !showSkipped;
      renderPlaces(p);
    }, "link");
    s.replaceChildren(`You skipped ${skipped.length === 1 ? "1 place" : `${skipped.length} places`}. `, t);
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>(".filters button")) b.setAttribute("aria-pressed", String(b.dataset.filter === filter));
  renderMap(p);
}

/**
 * Map markers: one focusable button per place, plus a ring at the reported spot for "moved"
 * answers. HTML markers like the live page, so the map needs no worker.
 */
const markers: maplibregl.Marker[] = [];
function renderMap(p: ReviewPage) {
  if (!map) return;
  for (const m of markers.splice(0)) m.remove();
  for (const x of p.places) {
    const b = el("button", `pin ${x.state === "open" && needsLook(x) ? "look" : x.state}`);
    b.type = "button";
    b.classList.toggle("selected", x.id === selected);
    b.setAttribute("aria-label", `${label(x, n)}${stateLabel(x) ? `, ${stateLabel(x)}` : ""}`);
    b.onclick = () => {
      select(x.id, false);
      document.getElementById(`place-${x.id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    };
    markers.push(new maplibregl.Marker({ element: b }).setLngLat([x.lon, x.lat]).addTo(map));
    for (const r of x.reports) {
      if (r.kind !== "moved" || r.lon === undefined || r.lat === undefined) continue;
      const spot = el("span", "spot");
      spot.title = `${label(x, n)}: reported spot`;
      markers.push(new maplibregl.Marker({ element: spot }).setLngLat([r.lon, r.lat]).addTo(map));
    }
  }
}

function select(id: number, fly: boolean) {
  selected = id;
  const p = page?.places.find((x) => x.id === id);
  for (const r of document.querySelectorAll(".place")) r.classList.toggle("selected", r.id === `place-${id}`);
  if (page) renderMap(page);
  if (map && p && fly) map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 18), duration: 400 });
}

function startMap(style: string) {
  map = new maplibregl.Map({ container: "map", style, center: [0, 0], zoom: 1, attributionControl: { compact: true }, dragRotate: false });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
}

let fitted = false;
function fitOnce(p: ReviewPage) {
  if (!map) return;
  if (fitted || !p.places.length) return;
  fitted = true;
  // The map started while the page was still hidden, at zero size.
  map.resize();
  const b = new maplibregl.LngLatBounds();
  for (const x of p.places) b.extend([x.lon, x.lat]);
  map.fitBounds(b, { padding: 48, maxZoom: 17, animate: false });
}

async function load() {
  let bearer: string | undefined;
  if (signedIn()) bearer = await accessToken().catch(() => undefined);
  const result = await fetchReview(token, bearer);
  if ("page" in result) {
    page = result.page;
    n = noun(page.campaign.match ?? {});
    $("message").hidden = true;
    for (const id of ["header", "stage", "footer"]) $(id).hidden = false;
    renderHeader(page);
    renderAccount();
    renderPlaces(page);
    fitOnce(page);
  } else if (result.problem === "missing") {
    message("This link doesn't work", "It may have been replaced with a new one. Ask the organizer for the current link.");
  } else if (result.problem === "off") {
    message("This page is turned off", "The organizer has turned off this campaign's pages.");
  } else {
    message("The answers can't load right now", "Check your connection and reload the page.");
  }
}

async function boot() {
  try {
    await loadConfig();
  } catch {
    message("This page isn't set up yet", "config.json is missing or invalid.");
    return;
  }
  if (location.pathname.replace(/\/$/, "") === "/review/callback") {
    const params = new URLSearchParams(location.search);
    const t = rememberedToken();
    // Keep the code out of the address bar and history.
    history.replaceState(null, "", t ? `/review/${t}` : "/review/");
    try {
      await completeSignIn(params);
    } catch {
      // Carry on signed out; the account box offers sign-in again.
    }
  }
  const t = tokenFrom(location.pathname);
  if (!t) {
    message("This link doesn't work", "It may have been replaced with a new one. Ask the organizer for the current link.");
    return;
  }
  token = t;
  rememberToken(t);
  if (config().mapStyle) startMap(config().mapStyle);
  else {
    $("map").hidden = true;
    document.body.classList.add("list-mode");
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>(".filters button")) {
    b.onclick = () => {
      filter = b.dataset.filter as Filter;
      if (page) renderPlaces(page);
    };
  }
  $("copy").onclick = async () => {
    const text = $("comment").textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      $("copied").textContent = "Copied";
    } catch {
      getSelection()?.selectAllChildren($("comment"));
      $("copied").textContent = "Selected. Copy it with your keyboard.";
    }
  };
  await load();
}

void boot();
