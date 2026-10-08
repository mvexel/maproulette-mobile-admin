from __future__ import annotations

import math
from typing import Any

from .config import Config


class ValidationError(Exception):
    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def bbox_area_km2(s: float, w: float, n: float, e: float) -> float:
    mid = math.radians((s + n) / 2)
    return abs(n - s) * 111.32 * abs(e - w) * 111.32 * math.cos(mid)


def _check_pos(p: Any) -> None:
    if not (isinstance(p, list) and len(p) >= 2 and _num(p[0]) and _num(p[1])):
        raise ValidationError("invalid_region", "coordinates must be [lon, lat] numbers")
    if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
        raise ValidationError("invalid_region", "coordinates out of range")


def _polygon_positions(coords: Any, cfg: Config) -> list[list[float]]:
    if not isinstance(coords, list) or not coords:
        raise ValidationError("invalid_region", "polygon needs at least one ring")
    out: list[list[float]] = []
    for ring in coords:
        if not isinstance(ring, list) or len(ring) < 4:
            raise ValidationError("invalid_region", "each ring needs at least 4 positions")
        for p in ring:
            _check_pos(p)
        if ring[0][:2] != ring[-1][:2]:
            raise ValidationError("invalid_region", "rings must be closed")
        out.extend(ring)
    return out


def validate_input(body: Any, cfg: Config) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ValidationError("invalid_request", "body must be a JSON object")
    name = body.get("name")
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValidationError("invalid_name", "name must be 1 to 100 characters")
    rules = body.get("rules")
    if not isinstance(rules, list) or not 1 <= len(rules) <= 10:
        raise ValidationError("invalid_rules", "rules must have 1 to 10 entries")
    for r in rules:
        if not isinstance(r, dict) or not r or not all(
            isinstance(k, str) and k and isinstance(v, str) and v for k, v in r.items()
        ):
            raise ValidationError("invalid_rules", "each rule must be a non-empty {tag: value} object")
    region = body.get("region")
    if not isinstance(region, dict):
        raise ValidationError("invalid_region", "region is required")
    if region.get("type") == "bbox":
        b = region.get("bbox")
        if not (isinstance(b, list) and len(b) == 4 and all(_num(x) for x in b)):
            raise ValidationError("invalid_region", "bbox must be [south, west, north, east]")
        s, w, n, e = b
        if not (-90 <= s < n <= 90 and -180 <= w < e <= 180):
            raise ValidationError("invalid_region", "bbox out of range or not ordered south<north, west<east")
        area = bbox_area_km2(s, w, n, e)
        clean: dict[str, Any] = {"type": "bbox", "bbox": [s, w, n, e]}
    elif region.get("type") == "geojson":
        g = region.get("geometry")
        if not isinstance(g, dict) or g.get("type") not in ("Polygon", "MultiPolygon"):
            raise ValidationError("invalid_region", "geometry must be a Polygon or MultiPolygon")
        polys = [g.get("coordinates")] if g["type"] == "Polygon" else g.get("coordinates")
        if not isinstance(polys, list) or not polys:
            raise ValidationError("invalid_region", "geometry has no coordinates")
        pos: list[list[float]] = []
        for p in polys:
            pos.extend(_polygon_positions(p, cfg))
            if len(pos) > cfg.max_vertices:
                raise ValidationError("invalid_region", f"polygon exceeds {cfg.max_vertices} vertices")
        lons, lats = [p[0] for p in pos], [p[1] for p in pos]
        area = bbox_area_km2(min(lats), min(lons), max(lats), max(lons))
        if area <= 0:
            raise ValidationError("invalid_region", "region has zero area")
        clean = {"type": "geojson", "geometry": {"type": g["type"], "coordinates": g["coordinates"]}}
    else:
        raise ValidationError("invalid_region", "region.type must be bbox or geojson")
    if area <= 0:
        raise ValidationError("invalid_region", "region has zero area")
    if area > cfg.max_area_km2:
        raise ValidationError("area_too_large", f"region covers about {area:.0f} km2, the limit is {cfg.max_area_km2:.0f} km2")
    return {"name": name.strip(), "region": clean, "rules": [dict(r) for r in rules]}
