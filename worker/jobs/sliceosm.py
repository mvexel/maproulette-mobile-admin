"""Minimal SliceOSM client (see .scratch-7/sliceosm-api.md)."""
from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.request
from typing import Any

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


class SubmitRejected(Exception):
    """Definite non-creation: 400. ``code`` is region_rejected or too_large."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class SubmitBusy(Exception):
    """503: nothing was created; safe to retry."""


class SubmitUncertain(Exception):
    """Timeout, 5xx other than 503, malformed 201: a job may exist; never re-POST."""


class Transient(Exception):
    """Retryable network or server error on a read."""


class NotFound(Exception):
    pass


class TooBig(Exception):
    pass


class SliceClient:
    def __init__(self, base_url: str, files_base_url: str, timeout: float = 30.0) -> None:
        self.base = base_url
        self.files_base = files_base_url
        self.timeout = timeout

    def submit(self, body: dict[str, Any]) -> str:
        req = urllib.request.Request(
            self.base + "api/",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                status, text = r.status, r.read(4096).decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            text = e.read(4096).decode("utf-8", "replace")
            if e.code == 400:
                if "limit of nodes" in text:
                    raise SubmitRejected("too_large", "SliceOSM: the area contains too many nodes") from None
                raise SubmitRejected("region_rejected", "SliceOSM rejected the region") from None
            if e.code == 503:
                raise SubmitBusy() from None
            raise SubmitUncertain(f"HTTP {e.code}") from None
        except Exception as e:  # timeout, reset, DNS
            raise SubmitUncertain(f"{type(e).__name__}: {e}") from None
        uuid = text.strip().strip('"')
        if status != 201 or not UUID_RE.match(uuid):
            raise SubmitUncertain(f"unexpected response {status}")
        return uuid

    def status(self, uuid: str) -> dict[str, Any]:
        try:
            with urllib.request.urlopen(f"{self.base}api/{uuid}", timeout=self.timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound() from None
            raise Transient(f"HTTP {e.code}") from None
        except Exception as e:
            raise Transient(f"{type(e).__name__}: {e}") from None

    def download(self, uuid: str, dest: str, max_bytes: int, expected: int | None) -> tuple[int, str]:
        """Stream the PBF to ``dest``; returns (bytes, sha256)."""
        h = hashlib.sha256()
        n = 0
        try:
            with urllib.request.urlopen(f"{self.files_base}{uuid}.osm.pbf", timeout=self.timeout) as r:
                cl = r.headers.get("Content-Length")
                if cl and cl.isdigit() and int(cl) > max_bytes:
                    raise TooBig()
                with open(dest, "wb") as f:
                    while chunk := r.read(1 << 20):
                        n += len(chunk)
                        if n > max_bytes:
                            raise TooBig()
                        h.update(chunk)
                        f.write(chunk)
        except TooBig:
            raise
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound() from None
            raise Transient(f"HTTP {e.code}") from None
        except Exception as e:
            raise Transient(f"{type(e).__name__}: {e}") from None
        if expected and n != expected:
            raise Transient(f"truncated download: {n} of {expected} bytes")
        return n, h.hexdigest()
