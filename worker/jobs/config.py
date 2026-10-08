from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass
class Config:
    backend_origin: str = "http://backend.invalid"
    slice_url: str = "https://slice.openstreetmap.us/"
    files_base_url: str = ""  # default: <slice_url>files/
    data_dir: str = "/data"
    host: str = "0.0.0.0"
    port: int = 8000
    max_area_km2: float = 5000.0
    max_vertices: int = 5000
    max_active: int = 3
    max_features: int = 10000
    max_pbf_bytes: int = 500 * 1024 * 1024
    result_ttl_days: float = 7.0
    stall_timeout: float = 20 * 60
    deadline: float = 2 * 3600
    poll_min: float = 2.0
    poll_max: float = 30.0
    auth_ttl: float = 60.0
    http_timeout: float = 30.0
    download_attempts: int = 3

    def __post_init__(self) -> None:
        self.backend_origin = self.backend_origin.rstrip("/")
        if not self.slice_url.endswith("/"):
            self.slice_url += "/"
        if not self.files_base_url:
            self.files_base_url = self.slice_url + "files/"
        elif not self.files_base_url.endswith("/"):
            self.files_base_url += "/"

    @classmethod
    def from_env(cls, env=os.environ) -> "Config":
        d = cls()

        def get(name: str, default, cast):
            v = env.get(name)
            return cast(v) if v not in (None, "") else default

        return cls(
            backend_origin=get("BACKEND_ORIGIN", None, str) or _missing("BACKEND_ORIGIN"),
            slice_url=get("SLICEOSM_URL", d.slice_url, str),
            files_base_url=get("SLICEOSM_FILES_URL", "", str),
            data_dir=get("DATA_DIR", d.data_dir, str),
            port=get("PORT", d.port, int),
            max_area_km2=get("MAX_AREA_KM2", d.max_area_km2, float),
            max_vertices=get("MAX_VERTICES", d.max_vertices, int),
            max_active=get("MAX_ACTIVE", d.max_active, int),
            max_features=get("MAX_FEATURES", d.max_features, int),
            max_pbf_bytes=get("MAX_PBF_BYTES", d.max_pbf_bytes, int),
            result_ttl_days=get("RESULT_TTL_DAYS", d.result_ttl_days, float),
            stall_timeout=get("STALL_TIMEOUT_SECONDS", d.stall_timeout, float),
            deadline=get("DEADLINE_SECONDS", d.deadline, float),
        )


def _missing(name: str):
    raise SystemExit(f"{name} must be set")
