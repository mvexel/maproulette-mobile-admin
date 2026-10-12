# MapRoulette mobile admin

A web admin for the mobile-enabled MapRoulette backend fork
([maproulette-mobile-backend](https://github.com/mvexel/maproulette-mobile-backend), branch
`feat/mobile-oauth`). It registers the mobile OAuth clients and shows the admin audit log. Later
versions may clean up stale tasks and stuck submissions. It never
edits OpenStreetMap.

Admins are MapRoulette super-users. They sign in through the fork's mobile OAuth with the
`mobile:admin` scope (authorization code + PKCE, bearer tokens). Backend API:
[`docs/mobile-admin-api.md`](https://github.com/mvexel/maproulette-mobile-backend/blob/feat/mobile-oauth/docs/mobile-admin-api.md)
and [`docs/mobile-oauth.md`](https://github.com/mvexel/maproulette-mobile-backend/blob/feat/mobile-oauth/docs/mobile-oauth.md)
in the fork.

## Screens

- **Sign in.** Shows the connected backend. An account that is not a super-user gets a
  "Not a super-user" screen and no session.
- **Campaigns** (home). Every choice campaign on the backend with its project, whether it is in
  the app (Listed, Hidden: project off, Hidden: not published, Draft), progress and last change.
  Filters: All, In the app, Drafts. A campaign's page says what a participant sees, turns its
  project on or publishes it (after the publish checks), shares the app link with a QR code,
  shows progress, exports results as CSV or GeoJSON, and shows its texts.
- **New campaign.** Author questions/help/options and OSM tag mappings, load
  features, export a portable survey, preview generated tasks, pick or create the project, and
  publish a successfully imported new challenge after the publish checks. See the
  [authoring guide](docs/survey-authoring.md). Restaurant and bus-stop examples
  use the existing choice-task contract. Under Advanced, the old challenge form imports a
  line-by-line GeoJSON file into an existing challenge, for recovery.
- **Task writes.** On a field deployment, a super-user can turn mobile task and
  OSM edit submissions on or off for that backend. The switch starts off and
  every change is audited. The dev deployment keeps its fixed server policy.
- **Clients.** List, create, edit, disable (optionally revoking every sign-in of the client) and
  enable. Validation errors from the backend are listed. The backend refuses (`409 self_lockout`)
  to disable this app's own client or to remove `mobile:admin` from it; the screen explains why.
- **Audit log.** Every admin write, newest first, 25 per page. Read-only.

The header always shows the backend origin and the signed-in user.

## Configuration

The app reads `/config.json` at start, so one build serves any backend:

```json
{ "backend": "https://mr-api.osm.lol", "clientId": "maproulette-mobile-admin" }
```

- `backend`: the backend origin. The default is the current staging backend
  `https://mr-api.osm.lol`. **It will be renamed to `https://mr-dev.osm.lol`** (decision A15, no
  alias); change `BACKEND_ORIGIN` in the deployment then.
- `clientId`: the backend's OAuth client for this app, registered with `scopes = ["mobile:admin"]`
  and the redirect `https://<admin origin>/callback`.
- `environment` (optional): `dev`, `stage` or `prod`, shown as the header badge (PROD also turns
  the header border red). Without it the app infers it from the backend host (`mr-prod.*`,
  `mr-stage.*`, `mr-api.*`/`mr-dev.*`/localhost); any other host shows `UNKNOWN BACKEND`. The
  container sets it from `ADMIN_ENVIRONMENT`, and `vite` from `ADMIN_ENVIRONMENT` too.

The redirect URI is always `<the app's origin>/callback`. The backend must list it exactly for
the client, and must have `MR_MOBILE_ADMIN_ORIGIN` set to the app's origin for CORS.

`public/config.json` is the file used by `npm run dev`; the container writes its own (see Deploy).

## Token storage

- The **access token** (15 minutes) is kept in memory only.
- The **refresh token** is kept in `sessionStorage`: it survives a reload, is not shared with
  other tabs, and is gone when the tab closes. Each tab signs in separately.
- Refreshes are single-flight, because refresh tokens rotate and presenting an old one revokes
  the whole grant. A failed refresh ends the session; it is never retried with the old token.
- An API call that gets `401` refreshes once and retries once.
- **Sign out** forgets the tokens and revokes the grant at `/oauth/mobile/revoke`.

Why not a cookie: the backend is on another origin and its admin CORS is credential-free by
design. The exposure of `sessionStorage` is XSS, so the app ships a strict Content Security
Policy (scripts only from the app's own origin, `connect-src` only the backend) and `Referrer-Policy: no-referrer`.

## Develop

Node 24 (see `mise.toml`).

```sh
npm install
npm run dev:mock   # mock backend on 127.0.0.1:9300 + app on http://localhost:5173
npm run lint
npm run typecheck
npm test           # Vitest: auth and api against the mock
npx playwright install chromium   # once
npm run e2e        # Playwright: builds the app, runs it against the mock
npm run build
```

### Mock backend

`mock/server.ts` is a dependency-free Node mock of the fork's mobile OAuth provider and admin
API, with the same response shapes. It never touches the network beyond loopback. It covers
authorize (instead of the OSM login it offers a super-user and a non-super-user), the token
endpoint with PKCE and refresh rotation (replays revoke the grant), revoke, `/oauth/mobile/me`,
the clients API (validation, `client_exists`, `self_lockout`, `revokeGrants`) and audit paging.
Test-only routes: `POST /__mock/reset`, `POST /__mock/expire-access`, `GET /__mock/stats`.

Run it on its own with `npm run mock` (`MOCK_PORT`, `MOCK_ADMIN_ORIGIN`, `MOCK_ACCESS_SECONDS`).
With `ADMIN_BACKEND` set, `vite` and `vite preview` answer `/config.json` with that backend.

### Against a real backend

A sign-in only completes on an origin registered for the client. On staging that is
`https://admin.mr-dev.osm.lol`. For local work against staging, register
`http://localhost:5173/callback` on the client and add the origin to `MR_MOBILE_ADMIN_ORIGIN`,
or use the mock.

## Participant site (streettally.osm.lol)

`vite.street.config.ts` builds the pages participants see into `dist-street/`. The container
serves them on port 8080, and the shared Caddy puts them on https://streettally.osm.lol
([docs/deploy-streettally.md](docs/deploy-streettally.md)).

- `/` (`site/index.html`): a short root page.
- `/challenge/<id>` (`site/challenge.html`, `site/landing.js`): the campaign landing page, shown
  when a campaign link opens without the app. It links to the iPhone beta (`installUrl`) and the Android APK (`androidInstallUrl` with
  `androidVersion`) and opens the
  app with `mrchoice://challenge/<id>`, because iOS doesn't follow a universal link tapped on its
  own domain. It reads the campaign's name and blurb from `GET /api/v2/challenge/<id>` when the
  backend allows it, and otherwise shows generic text.
- `/privacy` (`site/privacy.html`): the privacy page every email footer and the claim page link to.
- `/faq` (`site/faq.html`): questions and answers for the Woodbine pilot, from
  `community/participant-faq-woodbine.md`. Keep it in step with `/privacy`.
- `/.well-known/apple-app-site-association`: the universal-link file for `/challenge/*`, written
  at start from `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID`.
- `/claim` (`claim/`): the page participants open from the deferred sign-up email to put their
  saved answers on OpenStreetMap (design docs `deferred-signup-ux.md` §3 and
  `deferred-signup-api.md` §3.6, §3.7, §3.10 and §3.11). It is a React app with the Street Tally brand
  and shares only `src/pkce.ts` with the admin app.
  - Links: `/claim#t=<token>`, `/claim/delete#t=<token>`, `/claim/stop-reminders#t=<token>`. The
    token stays in the fragment and `sessionStorage`; the page POSTs it to the claim routes.
  - Sign-in: the public `maproulette-claim` client with `tasks:read tasks:write osm:tagfix`,
    PKCE, redirect `https://streettally.osm.lol/claim/callback`. The page revokes its grant when
    the claim finishes.
  - Config: `/claim/config.json` with `backend`, `clientId`, `mapStyle` (a MapLibre style URL, the
    OpenFreeMap Positron style by default; empty hides the map) and `osmWeb` (for "See your
    edits").

`npm run dev:street` serves the whole site on http://localhost:5174. With `CLAIM_BACKEND` set
(e.g. `http://127.0.0.1:9300` and `npm run mock`), the dev and preview servers answer both
config files with that backend and no map (`CLAIM_MAP_STYLE` adds one, `SITE_INSTALL_URL` sets
the beta link, and `APPLE_TEAM_ID` plus `APPLE_BUNDLE_ID` serve the AASA file). The mock's fixed
claim tokens are in `MOCK_CLAIM_TOKENS` (`mock/server.ts`), e.g.
http://localhost:5174/claim#t=mock-claim-partialxxxxxxxxxxxxxxxxxxxxxxxxx, and its campaign is
http://localhost:5174/challenge/7.

## Deploy

The image (`Dockerfile`) builds both sites and serves them with its own small Caddy: the admin app
on port 80 and the participant site on port 8080. At start, `deploy/entrypoint.sh` writes the
admin `config.json` from `BACKEND_ORIGIN`, `CLIENT_ID`, `OSM_WEB` (for "sign out of OpenStreetMap") and the optional `ADMIN_ENVIRONMENT`; the
participant site's `config.json` from `BACKEND_ORIGIN`, `INSTALL_URL`, `ANDROID_INSTALL_URL` and
`ANDROID_VERSION`; `claim/config.json` from `BACKEND_ORIGIN`, `CLAIM_CLIENT_ID` and `OSM_WEB`; and
the apple-app-site-association file when `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID` are set. The
container's Caddyfile (`deploy/Caddyfile`) sets the CSP (with `BACKEND_ORIGIN` in
`connect-src`), `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `config.json` and the
app's HTML, and the single-page-app fallback. It does no TLS.

`deploy/compose.yaml` is the Komodo stack `maproulette-mobile-admin`. It joins the shared
`schaaltreinenhuis-ingress` network as `maproulette-mobile-admin`. Its declaration lives in
[mvexel/infra](https://github.com/mvexel/infra) (`komodo/resources.toml`):

```toml
file_paths = ["deploy/compose.yaml"]
environment = """
BACKEND_ORIGIN = https://mr-api.osm.lol
"""
```

The **shared Caddy** (infra `platform/Caddyfile`, stack `shared-caddy`) terminates TLS for the
public hostname and proxies to the container. Its site block is:

```caddyfile
https://admin.mr-dev.osm.lol {
  encode zstd gzip
  reverse_proxy maproulette-mobile-admin:80
}
```

On the backend, the client `maproulette-mobile-admin` needs the redirect
`https://admin.mr-dev.osm.lol/callback`, and `MR_MOBILE_ADMIN_ORIGIN=https://admin.mr-dev.osm.lol`.

For the separate production-OSM field deployments, Komodo uses the same
`deploy/compose.field.yaml` twice, with different project names, API hosts,
image tags, and ingress aliases. The stage site points only to
`mr-stage.osm.lol`; the prod site points only to `mr-prod.osm.lol`.
The field file passes the participant-site variables through as well (`OSM_WEB` defaults to
`https://www.openstreetmap.org`), so `streettally.osm.lol` can be served from the stage or prod
admin on port 8080 per [docs/deploy-streettally.md](docs/deploy-streettally.md).

## License

Apache-2.0, Copyright 2026 Martijn van Exel. See [LICENSE](LICENSE).
