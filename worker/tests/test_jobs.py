import json
import os
import urllib.error
import urllib.request

import pytest

from jobs.api import make_server
from jobs.auth import TokenValidator
from jobs.config import Config
from jobs.engine import Engine, TooManyActive
from jobs.sliceosm import SliceClient
from jobs.store import Store
from jobs.validate import ValidationError

BBOX = {"type": "bbox", "bbox": [42.35, -71.10, 42.37, -71.05]}
RULES = [{"amenity": "restaurant"}]
POLY = {"type": "Polygon", "coordinates": [[[-71.10, 42.35], [-71.05, 42.35], [-71.05, 42.37], [-71.10, 42.37], [-71.10, 42.35]]]}


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


class Env:
    def __init__(self, tmp_path, fake, **cfg):
        self.fake, self.clock, self.tmp = fake, Clock(), tmp_path
        self.cfg = Config(backend_origin=fake.url, slice_url=fake.url, data_dir=str(tmp_path), http_timeout=5, **cfg)
        self.open()

    def open(self):
        self.store = Store(os.path.join(self.cfg.data_dir, "jobs.sqlite"))
        self.engine = Engine(self.cfg, self.store, SliceClient(self.cfg.slice_url, self.cfg.files_base_url, 5), self.clock)

    def restart(self):
        self.store.close()
        self.open()
        self.engine.recover()

    def job(self, i):
        return self.store.get(i)

    def create(self, region=BBOX, rules=RULES, name="t"):
        return self.engine.create({"name": name, "region": region, "rules": rules})["id"]

    def run(self, jid, ticks=30, step=5.0):
        for _ in range(ticks):
            self.engine.tick()
            if self.job(jid)["state"] not in ("queued", "submitting", "slicing", "downloading", "converting"):
                break
            self.clock.t += step
        return self.job(jid)


@pytest.fixture
def env(tmp_path, fake, pbf_bytes):
    fake.pbf = pbf_bytes
    return Env(tmp_path, fake)


def test_bbox_happy_path(env):
    env.fake.script = [{"Timestamp": "", "ElemsTotal": 10, "ElemsProg": 2}, {"ElemsTotal": 10, "ElemsProg": 8}, "complete"]
    j = env.run(env.create())
    assert j["state"] == "complete", j["error"]
    assert env.fake.submits == [{"Name": "t", "RegionType": "bbox", "RegionData": [42.35, -71.10, 42.37, -71.05]}]
    r = j["result"]
    assert r["featureCount"] == 2 and r["omissionTotal"] == 0
    assert r["counts"]["outside_region"] == 1
    p = r["provenance"]
    assert p["sourceTimestamp"] == "2026-10-01T12:00:00Z" and p["pbfBytes"] == len(env.fake.pbf)
    assert len(p["pbfSha256"]) == 64 and p["rules"] == RULES and p["sliceosmJobId"]
    assert not os.path.exists(env.engine.pbf_path(j["id"]))
    fc = json.load(open(env.engine.result_path(j["id"])))
    assert {f["properties"]["@id"] for f in fc["features"]} == {"node/1", "node/2"}


def test_geojson_submission(env):
    env.fake.script = ["complete"]
    j = env.run(env.create({"type": "geojson", "geometry": POLY}))
    assert j["state"] == "complete"
    assert env.fake.submits[0]["RegionType"] == "geojson" and env.fake.submits[0]["RegionData"] == POLY
    assert j["result"]["featureCount"] == 2


def test_resume_mid_poll_does_not_resubmit(env):
    env.fake.script = [{"ElemsProg": 1, "ElemsTotal": 5}, {"ElemsProg": 2, "ElemsTotal": 5}, "complete"]
    jid = env.create()
    env.engine.tick(); env.clock.t += 5; env.engine.tick(); env.clock.t += 5
    assert env.job(jid)["state"] == "slicing"
    uuid = env.job(jid)["slice_uuid"]
    env.restart()
    j = env.run(jid)
    assert j["state"] == "complete" and j["slice_uuid"] == uuid
    assert len(env.fake.submits) == 1


def test_uncertain_submission_http_error(env):
    env.fake.submit_script = [(500, "boom")]
    j = env.run(env.create())
    assert j["state"] == "failed" and j["error"]["code"] == "submission_uncertain"
    assert len(env.fake.submits) == 1


def test_uncertain_after_restart_in_submitting(env):
    jid = env.create()
    env.store.update(jid, state="submitting")
    env.restart()
    assert env.job(jid)["error"]["code"] == "submission_uncertain"
    env.engine.tick()
    assert env.fake.submits == []


def test_submit_503_retries_then_succeeds(env):
    env.fake.submit_script = [(503, ""), (503, "")]
    env.fake.script = ["complete"]
    j = env.run(env.create(), ticks=100)
    assert j["state"] == "complete" and len(env.fake.submits) == 3


def test_invalid_region_rejected_by_slice(env):
    env.fake.submit_script = [(400, "")]
    j = env.run(env.create())
    assert j["error"]["code"] == "region_rejected"


def test_node_limit(env):
    env.fake.submit_script = [(400, "Error: the limit of nodes was exceeded.")]
    j = env.run(env.create())
    assert j["state"] == "failed" and j["error"]["code"] == "too_large"


def test_stall_timeout(env):
    env.fake.script = [{"ElemsProg": 1, "ElemsTotal": 5}]
    j = env.run(env.create(), ticks=500, step=30)
    assert j["error"]["code"] == "slice_stalled"
    assert env.clock.t - j["created_at"] >= env.cfg.stall_timeout


def test_total_deadline(env):
    # progress changes on every poll, so only the deadline can fire
    env.fake.script = [{"ElemsProg": i, "ElemsTotal": 10**6} for i in range(1, 2000)]
    j = env.run(env.create(), ticks=2000, step=20)
    assert j["error"]["code"] == "slice_timeout"


def test_slice_404_is_lost(env):
    env.fake.script = [{"ElemsProg": 1}, 404]
    j = env.run(env.create())
    assert j["error"]["code"] == "slice_lost"


def test_expiry(env):
    env.fake.script = ["complete"]
    j = env.run(env.create())
    assert j["state"] == "complete"
    env.clock.t += 7 * 86400 + 1
    env.engine.tick()
    assert env.job(j["id"])["state"] == "expired"
    assert not os.path.exists(env.engine.result_path(j["id"]))


def test_feature_cap(tmp_path, fake, pbf_bytes):
    fake.pbf = pbf_bytes
    e = Env(tmp_path, fake, max_features=1)
    fake.script = ["complete"]
    j = e.run(e.create())
    assert j["error"]["code"] == "too_many_features"
    assert not os.path.exists(e.engine.pbf_path(j["id"]))


def test_pbf_size_cap_and_truncation(tmp_path, fake, pbf_bytes):
    fake.pbf = pbf_bytes
    e = Env(tmp_path, fake, max_pbf_bytes=10)
    fake.script = ["complete"]
    assert e.run(e.create())["error"]["code"] == "too_large"
    (tmp_path / "b").mkdir()
    e2 = Env(tmp_path / "b", fake)
    fake.pbf_truncate = True
    j = e2.run(e2.create(), ticks=200, step=10)
    assert j["error"]["code"] == "download_failed"


def test_validation(env):
    c = env.engine.create
    bad = [
        ({"type": "bbox", "bbox": [42.37, -71.10, 42.35, -71.05]}, "invalid_region"),
        ({"type": "bbox", "bbox": [0, 0, 100, 1]}, "invalid_region"),
        ({"type": "bbox", "bbox": [0, 0, 10, 10]}, "area_too_large"),
        ({"type": "geojson", "geometry": {"type": "Point", "coordinates": [0, 0]}}, "invalid_region"),
        ({"type": "geojson", "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [0, 0]]]}}, "invalid_region"),
        ({"type": "nope"}, "invalid_region"),
    ]
    for region, code in bad:
        with pytest.raises(ValidationError) as ei:
            c({"name": "x", "region": region, "rules": RULES})
        assert ei.value.code == code
    for rules in ([], [{}], [{"a": ""}], [{"a": "b"}] * 11):
        with pytest.raises(ValidationError):
            c({"name": "x", "region": BBOX, "rules": rules})
    many = {"type": "Polygon", "coordinates": [[[i / 1e5, 0] for i in range(5001)] + [[0, 0.001], [0, 0]]]}
    with pytest.raises(ValidationError):
        c({"name": "x", "region": {"type": "geojson", "geometry": many}, "rules": RULES})


def test_concurrent_cap_and_cancel(tmp_path, fake):
    e = Env(tmp_path, fake, max_active=2)
    a, b = e.create(), e.create()
    with pytest.raises(TooManyActive):
        e.create()
    assert e.engine.cancel(a)["state"] == "cancelled"
    e.create()  # slot freed
    assert e.engine.cancel(a)["state"] == "cancelled"  # idempotent
    e.engine.tick()
    assert e.job(a)["state"] == "cancelled"


# ---- HTTP API ----

def call(url, method="GET", token=None, body=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read(), e.headers


@pytest.fixture
def http(env):
    env.fake.tokens = {"adm": 200, "user": 403}
    srv = make_server(env.engine, TokenValidator(env.cfg.backend_origin, 60, 5, env.clock), "127.0.0.1", 0)
    import threading
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    env.base = f"http://127.0.0.1:{srv.server_port}"
    yield env
    srv.shutdown()
    srv.server_close()


def test_auth(http):
    b = http.base
    assert call(b + "/jobs/health")[0] == 200
    assert call(b + "/jobs")[0] == 401
    assert call(b + "/jobs", token="bad")[0] == 401
    s, body, _ = call(b + "/jobs", token="user")
    assert s == 403 and json.loads(body)["error"] == "forbidden"
    before = http.fake.policy_calls
    assert call(b + "/jobs", token="adm")[0] == 200
    assert call(b + "/jobs", token="adm")[0] == 200
    assert http.fake.policy_calls == before + 1  # cached
    http.clock.t += 61
    assert call(b + "/jobs", token="adm")[0] == 200
    assert http.fake.policy_calls == before + 2


def test_api_flow(http):
    b = http.base
    http.fake.script = ["complete"]
    s, body, _ = call(b + "/jobs", "POST", "adm", {"name": "n", "region": BBOX, "rules": RULES})
    assert s == 201
    job = json.loads(body)
    assert job["state"] == "queued" and job["input"]["region"] == BBOX
    assert call(f"{b}/jobs/{job['id']}/features", token="adm")[0] == 409
    http.run(job["id"])
    s, body, h = call(f"{b}/jobs/{job['id']}/features", token="adm")
    assert s == 200 and h["Content-Type"] == "application/geo+json"
    assert len(json.loads(body)["features"]) == 2
    assert json.loads(call(f"{b}/jobs", token="adm")[1])["jobs"][0]["id"] == job["id"]
    http.clock.t += 8 * 86400
    http.engine.tick()
    assert call(f"{b}/jobs/{job['id']}/features", token="adm")[0] == 410
    assert call(f"{b}/jobs/{'0' * 8}-0000-0000-0000-{'0' * 12}", token="adm")[0] == 404


def test_api_errors_and_cancel(http):
    b = http.base
    s, body, _ = call(b + "/jobs", "POST", "adm", {"name": "n", "region": {"type": "bbox", "bbox": [1, 1, 0, 0]}, "rules": RULES})
    assert s == 422 and json.loads(body)["error"] == "invalid_region"
    ids = []
    for _ in range(3):
        s, body, _ = call(b + "/jobs", "POST", "adm", {"name": "n", "region": BBOX, "rules": RULES})
        assert s == 201
        ids.append(json.loads(body)["id"])
    s, body, _ = call(b + "/jobs", "POST", "adm", {"name": "n", "region": BBOX, "rules": RULES})
    assert s == 429
    s, body, _ = call(f"{b}/jobs/{ids[0]}/cancel", "POST", "adm")
    assert s == 200 and json.loads(body)["state"] == "cancelled"
