from __future__ import annotations

import json
import logging
import os
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from .auth import AuthUnavailable, TokenValidator
from .engine import Engine, TooManyActive, iso
from .validate import ValidationError

log = logging.getLogger("jobs")
ID_RE = re.compile(r"^[0-9a-f-]{36}$")
MAX_BODY = 2 * 1024 * 1024


def job_view(j: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": j["id"], "state": j["state"],
        "createdAt": iso(j["created_at"]), "updatedAt": iso(j["updated_at"]),
        "input": j["input"], "progress": j["progress"], "error": j["error"], "result": j["result"],
    }


def make_server(engine: Engine, validator: TokenValidator, host: str, port: int) -> ThreadingHTTPServer:
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "jobs"

        def log_message(self, fmt, *args):  # no tokens/paths with secrets, but keep it quiet
            log.info("%s %s", self.command, self.path.split("?")[0])

        def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status: int, obj: Any) -> None:
            self._send(status, json.dumps(obj).encode())

        def _err(self, status: int, code: str, message: str) -> None:
            self._json(status, {"error": code, "message": message})

        def _auth(self) -> bool:
            h = self.headers.get("Authorization", "")
            if not h.lower().startswith("bearer ") or not h[7:].strip():
                self._err(401, "unauthorized", "Bearer token required")
                return False
            try:
                status = validator.check(h[7:].strip())
            except AuthUnavailable:
                self._err(502, "auth_unavailable", "Could not verify the token with the backend")
                return False
            if status == 401:
                self._err(401, "unauthorized", "Invalid or expired token")
            elif status != 200:
                self._err(403, "forbidden", "Administrator access required")
            return status == 200

        def _route(self, method: str) -> None:
            path = self.path.split("?")[0].rstrip("/")
            if path == "/jobs/health" and method == "GET":
                return self._json(200, {"status": "ok"})
            parts = path.split("/")  # ['', 'jobs', ...]
            if parts[:2] != ["", "jobs"] or len(parts) > 4:
                return self._err(404, "not_found", "Unknown path")
            n = len(parts)
            known = (n == 2) or (n == 3 and ID_RE.match(parts[2])) or (
                n == 4 and ID_RE.match(parts[2]) and parts[3] in ("features", "cancel"))
            if not known:
                return self._err(404, "not_found", "Unknown path")
            if not self._auth():
                return
            if n == 2:
                if method == "GET":
                    return self._json(200, {"jobs": [job_view(j) for j in engine.store.list(50)]})
                if method == "POST":
                    return self._create()
                return self._err(405, "method_not_allowed", "Method not allowed")
            job = engine.store.get(parts[2])
            if job is None:
                return self._err(404, "not_found", "No such job")
            if n == 3 and method == "GET":
                return self._json(200, job_view(job))
            if n == 4 and parts[3] == "features" and method == "GET":
                if job["state"] == "expired":
                    return self._err(410, "expired", "The result has expired")
                if job["state"] != "complete":
                    return self._err(409, "not_complete", f"Job is {job['state']}")
                try:
                    with open(engine.result_path(job["id"]), "rb") as f:
                        data = f.read()
                except FileNotFoundError:
                    return self._err(410, "expired", "The result is no longer available")
                return self._send(200, data, "application/geo+json")
            if n == 4 and parts[3] == "cancel" and method == "POST":
                return self._json(200, job_view(engine.cancel(job["id"])))
            self._err(405, "method_not_allowed", "Method not allowed")

        def _create(self) -> None:
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length < 0 or length > MAX_BODY:
                return self._err(413, "too_large", "Request body too large")
            try:
                body = json.loads(self.rfile.read(length) or b"null")
            except ValueError:
                return self._err(400, "invalid_json", "Body must be JSON")
            try:
                job = engine.create(body)
            except ValidationError as e:
                return self._err(e.status, e.code, e.message)
            except TooManyActive:
                return self._err(429, "too_many_active_jobs",
                                 f"At most {engine.cfg.max_active} jobs can run at once")
            self._json(201, job_view(job))

        def do_GET(self):
            self._safe("GET")

        def do_POST(self):
            self._safe("POST")

        def do_PUT(self):
            self._safe("PUT")

        def do_DELETE(self):
            self._safe("DELETE")

        def _safe(self, method: str) -> None:
            try:
                self._route(method)
            except Exception:
                log.exception("request failed")
                self._err(500, "internal_error", "Internal error")

    return ThreadingHTTPServer((host, port), Handler)
