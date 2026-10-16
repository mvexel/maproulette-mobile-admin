# Deploying streettally.osm.lol

The participant site (root page, campaign landing pages, the claim page and the
apple-app-site-association file) ships in the same image as the admin app, on container port
8080. Nothing new needs building or pulling. These are the steps to put it on
https://streettally.osm.lol against the dev backend. **Nothing here has been deployed.**

## 1. DNS

Point `streettally.osm.lol` at the VPS (an A/AAAA record, unless an `*.osm.lol` wildcard
already covers it).

## 2. Shared Caddy (mvexel/infra, `platform/Caddyfile`, stack `shared-caddy`)

Add a site block next to the admin one. The container is already on the ingress network as
`maproulette-mobile-admin`, so port 8080 doesn't need publishing:

```caddyfile
https://streettally.osm.lol {
  encode zstd gzip
  reverse_proxy maproulette-mobile-admin:8080
}
```

Caddy gets the certificate on first request. Don't add a redirect for `/.well-known/*`: Apple
fetches the apple-app-site-association file without following redirects.

## 3. Komodo stack `maproulette-mobile-admin` (mvexel/infra, `komodo/resources.toml`)

`deploy/compose.yaml` already passes the new variables through. Add the values to the stack's
`environment` and redeploy it:

```toml
environment = """
BACKEND_ORIGIN = https://mr-api.osm.lol
OSM_WEB = https://master.apis.dev.openstreetmap.org
INSTALL_URL = https://testflight.apple.com/join/<code>
APPLE_TEAM_ID = <10-character team ID>
APPLE_BUNDLE_ID = <bundle ID>
"""
```

- `INSTALL_URL`: the public TestFlight link. Empty hides the install button and asks
  participants that the invitation is not available yet.
- `ANDROID_INSTALL_URL`: the actual HTTPS download URL for the intended signed APK.
- `ANDROID_VERSION`: the exact version label for that APK (up to 80 characters: letters, numbers, spaces, `.`, `_`, `+`, `-`). Both Android fields are required to show the download action. Empty fields show truthful unavailability, not a placeholder download.
- `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID`: from the iOS app (Swift has them). With either one
  empty, no apple-app-site-association file is served, and campaign links open the landing page
  instead of the app. With a free personal team, universal links may not work at all; the
  landing page's "Open the campaign" button (`mrchoice://`) still does.
- `CLAIM_CLIENT_ID` defaults to `maproulette-claim`.
- `REVIEW_CLIENT_ID` defaults to `street-tally-review`: the review page's public client, scopes `tasks:read` (no OSM scope), redirect URI `https://<site>/review/callback`. The backend needs that client registered before mappers can sign in on `/review/<token>`; reading the page works without it.

The container refuses to start if any of these is malformed; `docker logs` says which one.

## 4. Backend (dev)

The claim page only works once the backend knows its origin:

- `MR_CLAIM_ORIGIN=https://streettally.osm.lol` (deferred-signup-api.md §5).
- The `maproulette-claim` client's redirect URI is `https://streettally.osm.lol/claim/callback`.
- The CORS list in §5 should also cover `/api/v2/mobile-claim/delete` and
  `/api/v2/mobile-claim/stop-reminders`; the page calls both from the browser.
- Optional: CORS for `GET /api/v2/challenge/<id>` from the same origin lets the landing page
  show the campaign's name and blurb. Without it, the page uses generic text.

## 5. iOS app

Universal links need the Associated Domains entitlement `applinks:streettally.osm.lol` in the
app, with the same team and bundle IDs as step 3.

## 6. Check

```sh
curl -sI https://streettally.osm.lol/ | head -1                      # 200
curl -s  https://streettally.osm.lol/config.json                     # backend and installUrl
curl -s  https://streettally.osm.lol/claim/config.json               # backend and maproulette-claim
curl -sI https://streettally.osm.lol/.well-known/apple-app-site-association | grep -i content-type  # application/json
```

Then open https://streettally.osm.lol/challenge/<id> on an iPhone without the app (landing page)
and with it (the app opens). Apple caches the association file through its CDN, so a change can
take a while to reach phones.

To roll back, remove the site block from the shared Caddy. The admin app on port 80 is unchanged.

## Participant-page local checks

`SITE_INSTALL_URL`, `SITE_ANDROID_INSTALL_URL` and `SITE_ANDROID_VERSION` supply the same fields to `npm run dev:street` / preview when `CLAIM_BACKEND` is set. Leave links empty until real artifacts are verified; test fixtures are never deployment links. Both platform instructions remain visible, with one explicit `mrchoice://challenge/<id>` return action. The apps already register this scheme; Android HTTPS App Links are not configured by this change.

Verify fresh install and already-installed return on both real phones with the selected campaign and exact build. Browser tests do not demonstrate native installation, TestFlight enrollment, signing or deployment. Campaign/config failures show a retry instead of an unverified generic invitation. Real backend CORS must permit the campaign read for the participant origin.
