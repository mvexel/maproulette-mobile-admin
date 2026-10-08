"""Convert an OSM PBF into the survey builder's feature input.

Output: GeoJSON FeatureCollection of Points; ``properties`` holds every current
OSM tag as a string plus ``@id`` = ``node/ID`` | ``way/ID`` | ``relation/ID``
(the original element, never osmium's synthetic area id).

Rule semantics (kept deliberately simple)
-----------------------------------------
``rules`` is a list of rules. A feature is a candidate if ANY rule matches (OR).
A rule is a mapping ``{key: value}``; ALL pairs must match (AND). Value ``"*"``
means "key present with any value". Matching is exact and case-sensitive on the
element's current tags (for areas built from relations: the relation tags).

Geometry
--------
* node: its own coordinates.
* closed way that osmium assembles into an area: ``representative_point`` of the
  surface (always inside the polygon, holes respected).
* closed way osmium does not treat as an area (e.g. ``area=no``): a point on the line.
* open way: point on line (midpoint by length, lies on the line).
* multipolygon/boundary relation: ``representative_point`` of the assembled
  (multi)polygon.
* any other matching relation: omitted as ``unsupported_relation``.

Region clipping
---------------
Applied to the representative point only (not the full geometry). Boundary is
inclusive (shapely ``covers``): a point exactly on the region edge is kept;
points in holes are excluded. Elements outside the region that exist only as
reference-completion objects in the PBF are therefore dropped unless their
representative point lies inside.

Omissions are reported with a reason, never invented. Duplicates by typed id:
first occurrence wins, counted in ``duplicates``.
"""
from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Mapping, Sequence

import osmium
import shapely
from shapely.geometry import LineString, shape
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep

Rule = Mapping[str, str]


@dataclass
class Omission:
    id: str
    reason: str  # unresolved_geometry | unsupported_relation | area_assembly_failed | invalid_geometry
    detail: str = ""


@dataclass
class ExtractionReport:
    source_sha256: str
    replication_timestamp: str | None
    rules: list[dict[str, str]]
    region_applied: bool
    counts: dict[str, int] = field(default_factory=dict)
    omissions: list[Omission] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ExtractionResult:
    feature_collection: dict[str, Any]
    report: ExtractionReport


def parse_rules(rules: Rule | Iterable[Rule]) -> list[dict[str, str]]:
    """Normalise to a non-empty list of non-empty {str: str} rules."""
    if isinstance(rules, Mapping):
        rules = [rules]
    out = [{str(k): str(v) for k, v in r.items()} for r in rules]
    if not out or any(not r for r in out):
        raise ValueError("at least one non-empty identity rule is required")
    return out


def load_region(geojson: Mapping[str, Any]) -> BaseGeometry:
    """Union of all Polygon/MultiPolygon geometries in a GeoJSON object."""
    geoms: list[BaseGeometry] = []

    def walk(o: Mapping[str, Any]) -> None:
        t = o.get("type")
        if t == "FeatureCollection":
            for f in o["features"]:
                walk(f)
        elif t == "Feature":
            walk(o["geometry"])
        elif t in ("Polygon", "MultiPolygon"):
            geoms.append(shape(o))
        elif t == "GeometryCollection":
            for g in o["geometries"]:
                walk(g)
        else:
            raise ValueError(f"unsupported region geometry: {t}")

    walk(geojson)
    if not geoms:
        raise ValueError("region contains no polygon")
    region = shapely.union_all(geoms)
    if not region.is_valid:
        region = shapely.make_valid(region)
    return region


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _matches(tags: Mapping[str, str], rules: Sequence[Rule]) -> bool:
    return any(
        all(k in tags and (v == "*" or tags[k] == v) for k, v in r.items())
        for r in rules
    )


def _tags(o: Any) -> dict[str, str]:
    return {t.k: t.v for t in o.tags}


def extract_features(
    pbf_path: str,
    rules: Rule | Iterable[Rule],
    region: BaseGeometry | Mapping[str, Any] | None = None,
) -> ExtractionResult:
    rules = parse_rules(rules)
    if region is not None and isinstance(region, Mapping):
        region = load_region(region)
    prepared = prep(region) if region is not None else None

    sha = sha256_file(pbf_path)
    fp = osmium.FileProcessor(pbf_path).with_areas()  # also enables node locations
    ts = fp.header.get("osmosis_replication_timestamp") or None

    wkb = osmium.geom.WKBFactory()
    features: dict[str, dict[str, Any]] = {}
    omissions: list[Omission] = []
    counts = dict(candidates=0, emitted=0, duplicates=0, outside_region=0, omitted=0)
    # candidates whose geometry arrives later (areas) -> resolved or reported at end
    pending_closed_ways: dict[str, str] = {}   # typed id -> "line fallback" marker
    pending_relations: dict[str, dict[str, str]] = {}  # typed id -> full relation tags

    def omit(tid: str, reason: str, detail: str = "") -> None:
        omissions.append(Omission(tid, reason, detail))
        counts["omitted"] += 1

    def emit(tid: str, tags: dict[str, str], pt: tuple[float, float]) -> None:
        if tid in features:
            counts["duplicates"] += 1
            return
        if prepared is not None and not prepared.covers(shapely.Point(*pt)):
            counts["outside_region"] += 1
            return
        features[tid] = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [pt[0], pt[1]]},
            "properties": {"@id": tid, **tags},
        }
        counts["emitted"] += 1

    def way_line(w: Any) -> LineString | None:
        pts = []
        for n in w.nodes:  # primitives are copied to plain floats immediately
            if not n.location.valid():
                return None
            pts.append((n.lon, n.lat))
        if len(pts) < 2 or len(set(pts)) < 2:
            return None
        return LineString(pts)

    def line_point(line: LineString) -> tuple[float, float]:
        p = line.interpolate(0.5, normalized=True)
        return (p.x, p.y)

    for o in fp:
        if o.is_node():
            tags = _tags(o)
            if not tags or not _matches(tags, rules) or not o.location.valid():
                continue
            counts["candidates"] += 1
            emit(f"node/{o.id}", tags, (o.lon, o.lat))
        elif o.is_way():
            tags = _tags(o)
            if not tags or not _matches(tags, rules):
                continue
            tid = f"way/{o.id}"
            if o.is_closed() and tags.get("area") != "no":
                # osmium will (try to) assemble this into an area; wait for it
                counts["candidates"] += 1
                pending_closed_ways[tid] = ""
                continue
            counts["candidates"] += 1
            line = way_line(o)
            if line is None:
                omit(tid, "unresolved_geometry", "missing node locations or <2 distinct nodes")
            else:
                emit(tid, tags, line_point(line))
        elif o.is_relation():
            tags = _tags(o)
            if not tags or not _matches(tags, rules):
                continue
            tid = f"relation/{o.id}"
            counts["candidates"] += 1
            pending_relations[tid] = tags
        elif o.is_area():
            tags = _tags(o)
            if not _matches(tags, rules):
                continue
            tid = f"{'way' if o.from_way() else 'relation'}/{o.orig_id()}"
            if tid in pending_closed_ways:
                del pending_closed_ways[tid]
            elif tid in pending_relations:
                tags = pending_relations.pop(tid)  # area tags drop "type"; keep all current tags
            else:
                # e.g. old-style multipolygon: tags on outer way, relation untagged
                counts["candidates"] += 1
            try:
                geom = shapely.from_wkb(wkb.create_multipolygon(o))
                if geom.is_empty:
                    raise ValueError("empty geometry")
                pt = geom.representative_point()
            except Exception as e:  # osmium.InvalidLocationError, GEOS errors
                omit(tid, "invalid_geometry", str(e))
                continue
            emit(tid, tags, (pt.x, pt.y))

    for tid in pending_closed_ways:
        omit(tid, "area_assembly_failed", "closed way did not yield a valid area")
    for tid, rtags in pending_relations.items():
        rtype = rtags.get("type", "")
        if rtype in ("multipolygon", "boundary"):
            omit(tid, "unresolved_geometry", "members missing from PBF or rings could not be assembled")
        else:
            omit(tid, "unsupported_relation", f"relation type {rtype!r} has no point geometry")

    report = ExtractionReport(
        source_sha256=sha,
        replication_timestamp=ts,
        rules=rules,
        region_applied=prepared is not None,
        counts=counts,
        omissions=omissions,
    )
    fc = {"type": "FeatureCollection", "features": list(features.values())}
    return ExtractionResult(fc, report)
