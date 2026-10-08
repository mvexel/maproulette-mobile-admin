import osmium
import pytest
from osmium.osm.mutable import Node, Relation, Way

REST = {"amenity": "restaurant"}


@pytest.fixture
def make_pbf(tmp_path):
    def build(nodes=(), ways=(), relations=(), ts="2026-01-02T03:04:05Z", name="t.osm.pbf"):
        path = tmp_path / name
        h = osmium.io.Header()
        if ts:
            h.set("osmosis_replication_timestamp", ts)
        with osmium.SimpleWriter(str(path), 4096, h) as w:
            for i, lon, lat, tags in nodes:
                w.add_node(Node(id=i, location=(lon, lat), tags=tags))
            for i, refs, tags in ways:
                w.add_way(Way(id=i, nodes=refs, tags=tags))
            for i, members, tags in relations:
                w.add_relation(Relation(id=i, members=members, tags=tags))
        return str(path)

    return build


import sys  # noqa: E402

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from fake_upstream import FakeUpstream  # noqa: E402


@pytest.fixture
def fake():
    f = FakeUpstream()
    yield f
    f.close()


@pytest.fixture
def pbf_bytes(make_pbf):
    # two restaurants inside the Boston-ish bbox, one outside, one cafe
    p = make_pbf(nodes=[
        (1, -71.07, 42.36, {"amenity": "restaurant", "name": "In"}),
        (2, -71.06, 42.36, {"amenity": "restaurant"}),
        (3, 10.0, 10.0, {"amenity": "restaurant"}),
        (4, -71.07, 42.36, {"amenity": "cafe"}),
    ], name="fixture.osm.pbf")
    return open(p, "rb").read()
