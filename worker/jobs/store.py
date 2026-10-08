from __future__ import annotations

import json
import sqlite3
import threading
from typing import Any

ACTIVE = ("queued", "submitting", "slicing", "downloading", "converting")
JSON_COLS = {"input", "progress", "error", "result", "request"}
SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  created_at REAL NOT NULL,
  updated_at REAL NOT NULL,
  input TEXT NOT NULL,
  progress TEXT,
  error TEXT,
  result TEXT,
  request TEXT,
  slice_uuid TEXT,
  slice_size INTEGER,
  source_ts TEXT,
  last_sig TEXT,
  last_change_at REAL,
  poll_n INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at REAL NOT NULL DEFAULT 0,
  pbf_sha256 TEXT,
  pbf_bytes INTEGER
);
CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state);
"""


class Store:
    """SQLite (WAL) job store; one shared connection guarded by a lock."""

    def __init__(self, path: str) -> None:
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA busy_timeout=5000")
        self._db.executescript(SCHEMA)

    @staticmethod
    def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
        if r is None:
            return None
        d = dict(r)
        for c in JSON_COLS:
            if d.get(c) is not None:
                d[c] = json.loads(d[c])
        return d

    def insert(self, job: dict[str, Any]) -> None:
        cols = list(job)
        vals = [json.dumps(job[c]) if c in JSON_COLS and job[c] is not None else job[c] for c in cols]
        with self._lock:
            self._db.execute(
                f"INSERT INTO jobs({','.join(cols)}) VALUES({','.join('?' * len(cols))})", vals
            )

    def get(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._row(self._db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,)
            ).fetchall()
        return [self._row(r) for r in rows]

    def in_states(self, states: tuple[str, ...]) -> list[dict[str, Any]]:
        q = ",".join("?" * len(states))
        with self._lock:
            rows = self._db.execute(
                f"SELECT * FROM jobs WHERE state IN ({q}) ORDER BY created_at, rowid", states
            ).fetchall()
        return [self._row(r) for r in rows]

    def count_active(self) -> int:
        q = ",".join("?" * len(ACTIVE))
        with self._lock:
            return self._db.execute(f"SELECT COUNT(*) FROM jobs WHERE state IN ({q})", ACTIVE).fetchone()[0]

    def update(self, job_id: str, expect: str | None = None, **fields: Any) -> bool:
        """Update fields; with ``expect`` only if the job is still in that state."""
        cols = list(fields)
        vals = [json.dumps(fields[c]) if c in JSON_COLS and fields[c] is not None else fields[c] for c in cols]
        sql = f"UPDATE jobs SET {','.join(c + '=?' for c in cols)} WHERE id=?"
        vals.append(job_id)
        if expect is not None:
            sql += " AND state=?"
            vals.append(expect)
        with self._lock:
            return self._db.execute(sql, vals).rowcount == 1

    def close(self) -> None:
        with self._lock:
            self._db.close()
