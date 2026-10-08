from __future__ import annotations

import hashlib
import time
import urllib.error
import urllib.request


class AuthUnavailable(Exception):
    pass


class TokenValidator:
    """Admin check: GET <backend>/api/v2/mobile-admin/write-policy; 200 = admin.

    Results (200/401/403) are cached per token hash for ``ttl`` seconds.
    """

    def __init__(self, backend_origin: str, ttl: float = 60.0, timeout: float = 10.0, clock=time.time) -> None:
        self.url = backend_origin.rstrip("/") + "/api/v2/mobile-admin/write-policy"
        self.ttl, self.timeout, self.clock = ttl, timeout, clock
        self._cache: dict[str, tuple[float, int]] = {}

    def check(self, token: str) -> int:
        key = hashlib.sha256(token.encode()).hexdigest()
        now = self.clock()
        hit = self._cache.get(key)
        if hit and hit[0] > now:
            return hit[1]
        req = urllib.request.Request(self.url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                status = 200 if r.status == 200 else 403
        except urllib.error.HTTPError as e:
            if e.code not in (401, 403):
                raise AuthUnavailable(f"backend returned {e.code}") from None
            status = e.code
        except Exception as e:
            raise AuthUnavailable(str(e)) from None
        if len(self._cache) > 1000:
            self._cache = {k: v for k, v in self._cache.items() if v[0] > now}
        self._cache[key] = (now + self.ttl, status)
        return status
