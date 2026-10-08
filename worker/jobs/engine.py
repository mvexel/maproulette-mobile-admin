"""Job state machine. ``tick()`` advances every active job one step; the clock is injectable."""
from __future__ import annotations

import json
import logging
import os
import time
import uuid as uuidlib
from datetime import datetime, timezone
from typing import Any, Callable

from extractor import extract_features, load_region

from . import sliceosm as so
from .config import Config
from .store import ACTIVE, Store
from .validate import ValidationError, validate_input

log = logging.getLogger("jobs")


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class TooManyActive(Exception):
    pass


class Engine:
    def __init__(self, cfg: Config, store: Store, client: so.SliceClient, clock: Callable[[], float] = time.time) -> None:
        self.cfg, self.store, self.client, self.clock = cfg, store, client, clock
        self.pbf_dir = os.path.join(cfg.data_dir, "pbf")
        self.result_dir = os.path.join(cfg.data_dir, "results")
        os.makedirs(self.pbf_dir, exist_ok=True)
        os.makedirs(self.result_dir, exist_ok=True)
        import threading

        self._create_lock = threading.Lock()

    # paths
    def pbf_path(self, job_id: str) -> str:
        return os.path.join(self.pbf_dir, f"{job_id}.osm.pbf")

    def result_path(self, job_id: str) -> str:
        return os.path.join(self.result_dir, f"{job_id}.geojson")

    # API-facing
    def create(self, body: Any) -> dict[str, Any]:
        inp = validate_input(body, self.cfg)
        with self._create_lock:
            if self.store.count_active() >= self.cfg.max_active:
                raise TooManyActive()
            now = self.clock()
            job_id = str(uuidlib.uuid4())
            self.store.insert({
                "id": job_id, "state": "queued", "created_at": now, "updated_at": now,
                "input": inp, "progress": {"stage": "queued", "fraction": None, "message": "Waiting to start"},
                "last_change_at": now, "next_at": 0,
            })
        return self.store.get(job_id)  # type: ignore[return-value]

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        job = self.store.get(job_id)
        if job and job["state"] in ACTIVE:
            self.store.update(job_id, expect=job["state"], state="cancelled", updated_at=self.clock(),
                              progress={"stage": "cancelled", "fraction": None, "message": "Cancelled"})
            self._cleanup(job_id)
            job = self.store.get(job_id)
        return job

    # lifecycle
    def recover(self) -> None:
        """Run once at startup, before the worker loop."""
        for job in self.store.in_states(("submitting",)):
            if not job["slice_uuid"]:
                self._fail(job, "submission_uncertain",
                           "The service restarted while submitting to SliceOSM; the request may or may not have "
                           "been accepted. Submit again if needed.")
        for job in self.store.in_states(("downloading",)):
            self.store.update(job["id"], next_at=0, attempts=0)
        for job in self.store.in_states(("converting",)):
            if not os.path.exists(self.pbf_path(job["id"])):
                self.store.update(job["id"], state="downloading", next_at=0, attempts=0)

    def tick(self) -> None:
        now = self.clock()
        for job in self.store.in_states(ACTIVE):
            if job["next_at"] > now:
                continue
            try:
                getattr(self, "_step_" + job["state"])(job)
            except Exception as e:  # never let one job kill the loop
                log.exception("job %s crashed", job["id"])
                self._fail(job, "internal_error", f"{type(e).__name__}: {e}")
        self._expire()

    def run_forever(self, interval: float = 1.0) -> None:
        while True:
            try:
                self.tick()
            except Exception:
                log.exception("tick failed")
            time.sleep(interval)

    # helpers
    def _cleanup(self, job_id: str) -> None:
        for p in (self.pbf_path(job_id), self.pbf_path(job_id) + ".part"):
            try:
                os.remove(p)
            except FileNotFoundError:
                pass

    def _fail(self, job: dict[str, Any], code: str, message: str) -> None:
        self.store.update(job["id"], expect=job["state"], state="failed", updated_at=self.clock(),
                          error={"code": code, "message": message},
                          progress={"stage": "failed", "fraction": None, "message": message})
        self._cleanup(job["id"])

    def _expire(self) -> None:
        cutoff = self.clock() - self.cfg.result_ttl_days * 86400
        for job in self.store.in_states(("complete",)):
            if job["updated_at"] <= cutoff:
                self.store.update(job["id"], expect="complete", state="expired", updated_at=self.clock(),
                                  progress={"stage": "expired", "fraction": None, "message": "Result expired"})
                try:
                    os.remove(self.result_path(job["id"]))
                except FileNotFoundError:
                    pass

    def _backoff(self, n: int) -> float:
        return min(self.cfg.poll_max, self.cfg.poll_min * (1.5 ** n))

    @staticmethod
    def _progress(stage: str, fraction: float | None, message: str) -> dict[str, Any]:
        return {"stage": stage, "fraction": fraction, "message": message}

    # steps
    def _step_queued(self, job: dict[str, Any]) -> None:
        now = self.clock()
        if now - job["created_at"] > self.cfg.deadline:
            return self._fail(job, "slice_timeout", "SliceOSM did not accept the request in time")
        inp = job["input"]
        region = inp["region"]
        body = {
            "Name": inp["name"],
            "RegionType": region["type"],
            "RegionData": region["bbox"] if region["type"] == "bbox" else region["geometry"],
        }
        # Persist the intent before the POST: a crash from here on means "uncertain".
        if not self.store.update(job["id"], expect="queued", state="submitting", request=body, updated_at=now,
                                 progress=self._progress("submitting", None, "Submitting to SliceOSM")):
            return
        try:
            slice_uuid = self.client.submit(body)
        except so.SubmitRejected as e:
            return self._fail({**job, "state": "submitting"}, e.code, str(e))
        except so.SubmitBusy:
            n = job["attempts"] + 1
            self.store.update(job["id"], expect="submitting", state="queued", attempts=n, updated_at=now,
                              next_at=now + min(60.0, 5.0 * 2 ** min(n, 4)),
                              progress=self._progress("queued", None, "SliceOSM is busy, retrying"))
            return
        except so.SubmitUncertain as e:
            return self._fail({**job, "state": "submitting"}, "submission_uncertain",
                              f"SliceOSM did not give a clear answer ({e}). The request may have created a job "
                              "there; it was not repeated. Submit again if needed.")
        self.store.update(job["id"], expect="submitting", state="slicing", slice_uuid=slice_uuid,
                          updated_at=now, last_change_at=now, last_sig=None, poll_n=0, attempts=0, next_at=now + self.cfg.poll_min,
                          progress=self._progress("slicing", None, "SliceOSM is preparing the extract"))

    def _step_submitting(self, job: dict[str, Any]) -> None:
        # Only reachable if recover() was skipped; treat as uncertain, never re-POST.
        if not job["slice_uuid"]:
            self._fail(job, "submission_uncertain", "Submission state unknown; submit again if needed.")

    def _step_slicing(self, job: dict[str, Any]) -> None:
        now = self.clock()
        if now - job["created_at"] > self.cfg.deadline:
            return self._fail(job, "slice_timeout", "SliceOSM took longer than the total time limit")
        try:
            st = self.client.status(job["slice_uuid"])
        except so.NotFound:
            return self._fail(job, "slice_lost", "SliceOSM no longer knows this job (expired or restarted)")
        except so.Transient:
            st = None
        sig, last_change = job["last_sig"], job["last_change_at"] or job["created_at"]
        fields: dict[str, Any] = {}
        if st is not None:
            if st.get("Complete"):
                self.store.update(job["id"], expect="slicing", state="downloading", updated_at=now, attempts=0,
                                  next_at=0, slice_size=int(st.get("SizeBytes") or 0),
                                  source_ts=st.get("Timestamp") or job["source_ts"],
                                  progress=self._progress("downloading", None, "Downloading the extract"))
                return
            new_sig = json.dumps([st.get(k) for k in ("CellsProg", "NodesProg", "ElemsProg", "Timestamp")])
            if new_sig != sig:
                sig, last_change = new_sig, now
                fields.update(last_sig=sig, last_change_at=now, poll_n=0)
                if st.get("Timestamp"):
                    fields["source_ts"] = st["Timestamp"]
            tot, prog = st.get("ElemsTotal") or 0, st.get("ElemsProg") or 0
            if not tot:
                tot, prog = st.get("NodesTotal") or 0, st.get("NodesProg") or 0
            frac = min(0.99, prog / tot) if tot else None
            fields["progress"] = self._progress("slicing", frac, "SliceOSM is preparing the extract")
        if now - last_change > self.cfg.stall_timeout:
            return self._fail(job, "slice_stalled", "SliceOSM reported no progress for too long")
        n = fields.get("poll_n", job["poll_n"])
        fields.update(poll_n=n + 1, next_at=now + self._backoff(n), updated_at=now)
        self.store.update(job["id"], expect="slicing", **fields)

    def _step_downloading(self, job: dict[str, Any]) -> None:
        now = self.clock()
        part = self.pbf_path(job["id"]) + ".part"
        size = job["slice_size"] or None
        if size and size > self.cfg.max_pbf_bytes:
            return self._fail(job, "too_large", f"The extract is {size} bytes; the limit is {self.cfg.max_pbf_bytes}")
        try:
            n, sha = self.client.download(job["slice_uuid"], part, self.cfg.max_pbf_bytes, size)
        except so.TooBig:
            return self._fail(job, "too_large", f"The extract exceeds {self.cfg.max_pbf_bytes} bytes")
        except so.NotFound:
            return self._fail(job, "slice_lost", "The SliceOSM extract is no longer available")
        except so.Transient as e:
            a = job["attempts"] + 1
            if a >= self.cfg.download_attempts:
                return self._fail(job, "download_failed", f"Could not download the extract: {e}")
            self.store.update(job["id"], expect="downloading", attempts=a, next_at=now + 5.0 * 2 ** a, updated_at=now)
            return
        os.replace(part, self.pbf_path(job["id"]))
        self.store.update(job["id"], expect="downloading", state="converting", pbf_sha256=sha, pbf_bytes=n,
                          updated_at=now, next_at=0,
                          progress=self._progress("converting", None, "Extracting features"))

    def _step_converting(self, job: dict[str, Any]) -> None:
        inp = job["input"]
        region = inp["region"]
        geom = region.get("geometry")
        if region["type"] == "bbox":
            s, w, n, e = region["bbox"]
            geom = {"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}
        try:
            res = extract_features(self.pbf_path(job["id"]), inp["rules"], region=load_region(geom))
        except Exception as e:
            return self._fail(job, "conversion_failed", f"{type(e).__name__}: {e}")
        fc = res.feature_collection
        count = len(fc["features"])
        if count > self.cfg.max_features:
            return self._fail(job, "too_many_features",
                              f"{count} features match; the limit is {self.cfg.max_features}. Narrow the area or the rules.")
        tmp = self.result_path(job["id"]) + ".tmp"
        with open(tmp, "w") as f:
            json.dump(fc, f)
        os.replace(tmp, self.result_path(job["id"]))
        rep = res.report.to_dict()
        now = self.clock()
        result = {
            "featureCount": count,
            "counts": rep["counts"],
            "omissions": rep["omissions"][:200],
            "omissionTotal": len(rep["omissions"]),
            "provenance": {
                "sliceosmJobId": job["slice_uuid"],
                "sourceTimestamp": job["source_ts"] or rep["replication_timestamp"],
                "pbfSha256": job["pbf_sha256"],
                "pbfBytes": job["pbf_bytes"],
                "request": job["request"],
                "rules": inp["rules"],
                "createdAt": iso(job["created_at"]),
            },
        }
        ok = self.store.update(job["id"], expect="converting", state="complete", result=result, updated_at=now,
                               progress=self._progress("complete", 1.0, f"{count} features"))
        if not ok:  # cancelled meanwhile
            try:
                os.remove(self.result_path(job["id"]))
            except FileNotFoundError:
                pass
        self._cleanup(job["id"])
