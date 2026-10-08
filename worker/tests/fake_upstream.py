"""Fake SliceOSM + fake MapRoulette backend on one local HTTP server."""
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class FakeUpstream:
    def __init__(self):
        self.submit_script = []   # (status, body) consumed in order; empty -> 201 new uuid
        self.submits = []         # parsed POST bodies
        self.script = []          # per-poll entries: dict | "complete" | int status; last repeats
        self.polls = {}           # uuid -> count
        self.pbf = b""
        self.pbf_status = 200
        self.pbf_truncate = False
        self.tokens = {}          # token -> status for write-policy
        self.policy_calls = 0
        outer = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _send(self, status, body=b"", ctype="text/plain"):
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                outer.submits.append(body)
                if outer.submit_script:
                    status, text = outer.submit_script.pop(0)
                else:
                    status, text = 201, str(uuid.uuid4())
                self._send(status, text.encode())

            def do_GET(self):
                p = self.path
                if p == "/api/v2/mobile-admin/write-policy":
                    outer.policy_calls += 1
                    tok = self.headers.get("Authorization", "").removeprefix("Bearer ")
                    return self._send(outer.tokens.get(tok, 401), b"{}", "application/json")
                if p.startswith("/files/"):
                    if outer.pbf_status != 200:
                        return self._send(outer.pbf_status)
                    data = outer.pbf[:-5] if outer.pbf_truncate else outer.pbf
                    return self._send(200, data, "application/octet-stream")
                if p.startswith("/api/"):
                    u = p[5:]
                    n = outer.polls.get(u, 0)
                    outer.polls[u] = n + 1
                    entry = outer.script[min(n, len(outer.script) - 1)]
                    if isinstance(entry, int):
                        return self._send(entry)
                    if entry == "complete":
                        entry = {"Timestamp": "2026-10-01T12:00:00Z", "SizeBytes": len(outer.pbf), "Complete": True}
                    return self._send(200, json.dumps(entry).encode(), "application/json")
                self._send(404)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.url = f"http://127.0.0.1:{self.server.server_port}/"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
