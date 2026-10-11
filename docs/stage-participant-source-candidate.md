# C-001 participant stage source candidate

Source preparation only, 2026-10-11 America/Denver. No live configuration, DNS,
merge, deployment, artifact publication or OSM write is authorized by this file.
This candidate reconciles selected admin main `5c5861a` and reviewed participant
`4c330316`; it retains admin reports and the reviewed campaign entry/return UX.

## Field Stack values to propose

Use `deploy/compose.field.yaml`, not the historical development Compose/runbook.
Its backend remains selected through `MR_API_HOST`; the stage candidate is:

```dotenv
MR_DEPLOYMENT=stage
MR_API_HOST=mr-stage.osm.lol
MR_ADMIN_NETWORK_ALIAS=maproulette-stage-admin
CLAIM_CLIENT_ID=maproulette-claim
INSTALL_URL=
ANDROID_INSTALL_URL=
ANDROID_VERSION=
APPLE_TEAM_ID=
APPLE_BUNDLE_ID=
```

Compose passes `BACKEND_ORIGIN=https://mr-stage.osm.lol`,
`ADMIN_ENVIRONMENT=stage`, and `OSM_WEB=https://www.openstreetmap.org`.
Artifact fields are intentionally empty: no installation link is available until
actual TestFlight/APK URL and Android version are verified. Only fill Apple IDs
from the selected real build; otherwise AASA is absent. Stack variables reach
container environment through the explicit field Compose mappings.

The container serves admin/config on internal port 80 and participant/config,
`/challenge/<id>`, `/privacy`, `/claim` and optional AASA on internal port 8080.
Both share the existing stage network alias; no host port publication is needed.

## Proposed shared Caddy diff — SOURCE CANDIDATE

Apply only after separate deployment approval and review in infra ownership.
Exact addition to `infra/platform/Caddyfile`, following the existing stage-admin
block (the current file has no streettally hostname block):

```diff
 https://admin.mr-stage.osm.lol {
   encode zstd gzip
   reverse_proxy maproulette-stage-admin:80
 }
+
+https://streettally.osm.lol {
+  encode zstd gzip
+  reverse_proxy maproulette-stage-admin:8080
+}
```

DNS is manual: verify/add the hostname's A/AAAA record to the actual VPS through
the owner; no address is invented here. No change was made to infra or live Caddy.
Keep the existing stage API/admin routes and admin port 80. Review/validate this
candidate with the shared-Caddy runbook before any authorized application.

## Contract and remaining gates

Backend native client must support read plus guest pending calls while field
writes stay OFF. Claim client registration, callback/CORS, claim runtime stack,
mail provider and later publication remain unresolved optional finish-later
gates; they are not prerequisites for a verified saved-pending receipt. Serving
claim assets does not prove those gates. No authenticated write grant is part of
the native pending-only contract. Real OSM display origin does not enable writes.

Campaign read CORS must permit `https://streettally.osm.lol`. Select real campaign
IDs only after approved field-confirmed campaign creation; fixture IDs and
artifact links used by browser tests are not release configuration.

Local build/lint/browser checks prove source integration only. Native installed/
fresh-install campaign return, real enrollment/APK/signature/version, deployed
DNS/TLS/config, actual backend client and unchanged field policy require separate
evidence. Rollback preparation retains stage admin/API; removal of only the new
hostname route and reverting the selected admin image/config is separately
approved using the existing ingress runbook, with no volume removal.
