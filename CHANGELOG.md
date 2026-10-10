# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Sign-in through the backend's mobile OAuth (`mobile:admin`, authorization code + PKCE). Access
  token in memory, refresh token in `sessionStorage`, single-flight refresh, one retry after a
  401, sign-out with revocation.
- A "Not a super-user" screen when the backend refuses the sign-in.
- Clients screen: list, create, edit, disable (optionally revoking sign-ins) and enable, with the
  backend's validation errors and a clear `self_lockout` message.
- Read-only, paged Audit log screen.
- The connected backend and the signed-in user are always visible.
- Runtime `/config.json`; the default backend is `https://mr-api.osm.lol` until the rename to
  `mr-dev.osm.lol`.
- A Node mock backend for local development and tests; Vitest and Playwright suites.
- Docker image with its own Caddy (CSP, `no-referrer`, no-store config) and a Komodo stack.
- The participant claim page (`claim/`, served under `/claim`) for deferred sign-up: opens the
  emailed `#t=` link, shows the saved answers on an OpenFreeMap map, signs in to OpenStreetMap
  with PKCE (`maproulette-claim`), starts the claim, follows its progress and explains what
  wasn't added. Also the delete-my-data and stop-reminders links, and the paused state while
  mobile writes are off. Built with `npm run build`; runtime `/claim/config.json`. Adds the
  `maplibre-gl` dependency, loaded only when the map is shown.
  Uses the §3.11 preview fields (campaign noun, tally, found, claim state): a claim stopped on
  re-auth or with failed rows asks the participant to sign in again, then retries it through
  `POST /api/v2/mobile-claim/:id/retry`; a failed result offers "Try again".
- The mock backend serves the claim routes (fixed tokens in `MOCK_CLAIM_TOKENS`, a
  `maproulette-claim` client, `POST /__mock/claim-writes`), including the §3.11 fields, the retry
  route and claims stopped on re-auth or with a failed row.
