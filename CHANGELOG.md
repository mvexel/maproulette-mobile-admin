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
