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
- **Clients.** List, create, edit, disable (optionally revoking every sign-in of the client) and
  enable. Validation errors from the backend are listed. The backend refuses (`409 self_lockout`)
  to disable this app's own client or to remove `mobile:admin` from it; the screen explains why.
- **Audit log.** Every admin write, newest first, 25 per page. Read-only.
- **Task writes.** On a field deployment, a super-user can turn mobile task and
  OSM edit submissions on or off for that backend. The switch starts off and
  every change is audited. The dev deployment keeps its fixed server policy.
- **Challenges.** Create a challenge and import line-by-line GeoJSON choice
  tasks with a per-line report. Setup works while the field task write switch
  is off. The backend audits creation and import.

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

## Deploy

The image (`Dockerfile`) builds the app and serves it with its own small Caddy on port 80. At
start, `deploy/entrypoint.sh` writes `config.json` from `BACKEND_ORIGIN` and `CLIENT_ID`. The
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

## License

Apache-2.0, Copyright 2026 Martijn van Exel. See [LICENSE](LICENSE).
