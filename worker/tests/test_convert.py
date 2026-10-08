import hashlib

import pytest
from shapely.geometry import Point, shape

from extractor import extract_features, load_region
from extractor.convert import parse_rules

REST = {"amenity": "restaurant"}
SQUARE = [(1, 0.0, 0.0, {}), (2, 0.0, 1.0, {}), (3, 1.0, 1.0, {}), (4, 1.0, 0.0, {})]


def by_id(res):
    return {f["properties"]["@id"]: f for f in res.feature_collection["features"]}


def test_node_and_provenance(make_pbf):
    p = make_pbf(nodes=[(10, 5.5, 6.5, {"amenity": "restaurant", "name": "A", "level": "1"}),
                        (11, 1, 1, {"amenity": "cafe"})])
    r = extract_features(p, REST)
    f = by_id(r)["node/10"]
    assert f["geometry"] == {"type": "Point", "coordinates": [5.5, 6.5]}
    assert f["properties"] == {"@id": "node/10", "amenity": "restaurant", "name": "A", "level": "1"}
    assert list(by_id(r)) == ["node/10"]
    assert r.report.source_sha256 == hashlib.sha256(open(p, "rb").read()).hexdigest()
    assert r.report.replication_timestamp == "2026-01-02T03:04:05Z"
    assert r.report.counts["emitted"] == 1


def test_closed_way_area_uses_way_id_and_interior_point(make_pbf):
    # concave U shape: centroid falls outside, representative point must be inside
    pts = [(1, 0, 0, {}), (2, 0, 10, {}), (3, 1, 10, {}), (4, 1, 1, {}), (5, 9, 1, {}),
           (6, 9, 10, {}), (7, 10, 10, {}), (8, 10, 0, {})]
    p = make_pbf(nodes=pts, ways=[(20, [1, 2, 3, 4, 5, 6, 7, 8, 1], {"amenity": "restaurant"})])
    r = extract_features(p, REST)
    f = by_id(r)["way/20"]
    poly = shape({"type": "Polygon", "coordinates": [[[0, 0], [0, 10], [1, 10], [1, 1], [9, 1], [9, 10], [10, 10], [10, 0], [0, 0]]]})
    assert poly.contains(shape(f["geometry"]))
    assert not any(k.startswith("area/") for k in by_id(r))
    assert r.report.omissions == []


def test_multipolygon_relation_keeps_relation_id(make_pbf):
    nodes = SQUARE + [(5, 0.2, 0.2, {}), (6, 0.2, 0.4, {}), (7, 0.4, 0.4, {}), (8, 0.4, 0.2, {})]
    p = make_pbf(
        nodes=nodes,
        ways=[(30, [1, 2, 3, 4, 1], {}), (31, [5, 6, 7, 8, 5], {})],
        relations=[(40, [("w", 30, "outer"), ("w", 31, "inner")],
                    {"type": "multipolygon", "amenity": "restaurant", "name": "R"})],
    )
    r = extract_features(p, REST)
    ids = by_id(r)
    assert list(ids) == ["relation/40"]
    pt = Point(*ids["relation/40"]["geometry"]["coordinates"])
    outer = shape({"type": "Polygon", "coordinates": [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]],
                                                      [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4], [0.4, 0.2], [0.2, 0.2]]]})
    assert outer.contains(pt)  # not in the hole
    assert ids["relation/40"]["properties"]["name"] == "R"
    assert "type" in ids["relation/40"]["properties"]  # tags are preserved as-is


def test_open_way_point_on_line(make_pbf):
    nodes = [(1, 0, 0, {}), (2, 0, 10, {}), (3, 10, 10, {})]
    p = make_pbf(nodes=nodes, ways=[(50, [1, 2, 3], {"amenity": "restaurant"})])
    r = extract_features(p, REST)
    pt = Point(*by_id(r)["way/50"]["geometry"]["coordinates"])
    from shapely.geometry import LineString
    assert LineString([(0, 0), (0, 10), (10, 10)]).distance(pt) < 1e-9


def test_unresolved_and_unsupported_relations(make_pbf):
    p = make_pbf(
        nodes=SQUARE,
        ways=[(30, [1, 2, 3, 4, 1], {})],
        relations=[
            (41, [("w", 30, "outer"), ("w", 999, "outer")], {"type": "multipolygon", "amenity": "restaurant"}),
            (42, [("n", 1, "")], {"type": "site", "amenity": "restaurant"}),
        ],
    )
    r = extract_features(p, REST)
    assert r.feature_collection["features"] == []
    reasons = {o.id: o.reason for o in r.report.omissions}
    assert reasons == {"relation/41": "unresolved_geometry", "relation/42": "unsupported_relation"}
    assert r.report.counts["omitted"] == 2


def test_open_way_with_missing_node_is_unresolved(make_pbf):
    p = make_pbf(nodes=[(1, 0, 0, {})], ways=[(60, [1, 77], {"amenity": "restaurant"})])
    r = extract_features(p, REST)
    assert [(o.id, o.reason) for o in r.report.omissions] == [("way/60", "unresolved_geometry")]


def test_duplicates_deduped_by_typed_id(make_pbf):
    # same typed id twice (two versions in a history-like file) -> one feature, counted
    p = make_pbf(nodes=[(10, 1, 1, {"amenity": "restaurant", "name": "v1"}),
                        (10, 2, 2, {"amenity": "restaurant", "name": "v2"})])
    r = extract_features(p, REST)
    assert len(r.feature_collection["features"]) == 1
    assert r.report.counts["duplicates"] == 1


def test_node_and_way_with_same_number_are_distinct(make_pbf):
    p = make_pbf(nodes=[(1, 0, 0, {"amenity": "restaurant"}), (2, 0, 1, {}), (3, 1, 1, {})],
                 ways=[(1, [1, 2, 3], {"amenity": "restaurant"})])
    assert set(by_id(extract_features(p, REST))) == {"node/1", "way/1"}


REGION = {"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [
    [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], [[4, 4], [4, 6], [6, 6], [6, 4], [4, 4]]]}}


def test_region_clipping_boundary_inclusive_and_holes(make_pbf):
    r_ = {"amenity": "restaurant"}
    p = make_pbf(nodes=[(1, 5, 2, r_), (2, 20, 20, r_), (3, 0, 5, r_), (4, 5, 5, r_)])
    r = extract_features(p, REST, region=REGION)
    assert set(by_id(r)) == {"node/1", "node/3"}  # edge kept, outside + hole dropped
    assert r.report.counts["outside_region"] == 2
    assert r.report.region_applied


def test_region_applies_to_representative_point_of_way(make_pbf):
    p = make_pbf(nodes=[(1, 20, 20, {}), (2, 20, 21, {}), (3, 5, 2, {})],
                 ways=[(70, [1, 2], {"amenity": "restaurant"})])
    assert by_id(extract_features(p, REST, region=load_region(REGION))) == {}


def test_rules_or_and_semantics(make_pbf):
    p = make_pbf(nodes=[
        (1, 0, 0, {"amenity": "restaurant", "cuisine": "thai"}),
        (2, 0, 0, {"amenity": "restaurant", "cuisine": "pizza"}),
        (3, 0, 0, {"amenity": "cafe"}),
        (4, 0, 0, {"shop": "bakery"}),
    ])
    and_rule = extract_features(p, {"amenity": "restaurant", "cuisine": "thai"})
    assert set(by_id(and_rule)) == {"node/1"}
    or_rules = extract_features(p, [{"amenity": "cafe"}, {"shop": "*"}])
    assert set(by_id(or_rules)) == {"node/3", "node/4"}
    with pytest.raises(ValueError):
        parse_rules([])
