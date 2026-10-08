# Feature acquisition (extraction jobs)

The `jobs` service turns an area plus tag rules into survey features: it asks SliceOSM for a
slice of OpenStreetMap, downloads the PBF, converts it with `worker/extractor` (pyosmium) and
serves a GeoJSON FeatureCollection to the admin SPA. The API contract is `.scratch-7/job-api.md`.

## Deployment

- `worker/Dockerfile` builds the service; `deploy/compose.yaml` and `deploy/compose.field.yaml`
  add a `jobs` service with a named volume `jobs-data` (SQLite and results, mounted at `/data`).
- `jobs` joins only the project's default network, not the shared `ingress`. The admin container
  joins both and its Caddy proxies `/jobs/*` to `jobs:8000` (`JOBS_UPSTREAM`), same origin, so the
  CSP is unchanged. `handle /jobs/*` comes before the static `handle`, because a top-level
  `try_files` would run first and rewrite the path to `/index.html`.
- Back up the `jobs-data` volume with the rest of the deployment data (results are reproducible,
  but job history is not).

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `BACKEND_ORIGIN` | required | MapRoulette API; tokens are checked at `/api/v2/mobile-admin/write-policy` |
| `SLICEOSM_URL` | `https://slice.openstreetmap.us/` | SliceOSM base URL |
| `SLICEOSM_FILES_URL` | `<SLICEOSM_URL>files/` | where PBFs are served (deployment-specific) |
| `DATA_DIR` | `/data` | SQLite DB, PBFs in flight, results |
| `MAX_AREA_KM2` | 5000 | area cap (bounding box of the region) |
| `MAX_ACTIVE` | 3 | concurrent non-finished jobs, 429 beyond |
| `MAX_FEATURES` | 10000 | output cap, else `too_many_features` |
| `MAX_PBF_BYTES` | 524288000 | download cap |
| `RESULT_TTL_DAYS` | 7 | then state `expired` and file deleted |
| `STALL_TIMEOUT_SECONDS` / `DEADLINE_SECONDS` | 1200 / 7200 | no progress change / total time |

Also fixed: polygon vertices <= 5000, rules 1..10, request body <= 2 MB.

## Failure behaviour

- Job state is in SQLite (WAL) and survives restarts. The SliceOSM id is stored as soon as the 201
  arrives; polling resumes after a restart.
- A submit is never repeated after an unclear answer (timeout, 5xx, bad body) or a restart while
  `submitting`: the job fails `submission_uncertain` and the admin may submit again. SliceOSM
  503 is safe and retried with backoff; 400 gives `region_rejected` or `too_large`.
- SliceOSM does not report failures, so a job whose counters stop moving fails `slice_stalled`
  after 20 minutes, and `slice_timeout` after 2 hours total. A 404 on poll gives `slice_lost`.
- Download: truncation (length vs `SizeBytes`) or network errors are retried 3 times, then
  `download_failed`. The PBF is deleted after conversion or failure.
- Auth results (200/401/403) are cached 60 s per token hash; backend unreachable gives 502.

## Isolated end-to-end test (no live SliceOSM)

1. Automated: `cd worker && pip install ".[test]" && python -m pytest`. A fake SliceOSM and fake
   backend run on localhost (needs permission to bind local ports).
2. By hand: run `python -m jobs` with `BACKEND_ORIGIN` and `SLICEOSM_URL` pointing at stand-ins
   (for example cantino's `scripts/fake-sliceosm.py`, which serves `files/<uuid>.osm.pbf`),
   then `curl -H "Authorization: Bearer <token>" -d '{...}' localhost:8000/jobs`.
3. Do not point test runs at the public SliceOSM; use a tiny area only with the owner's approval.
