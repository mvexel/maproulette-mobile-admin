# Contributing

Thanks for helping. This is a small app; keep changes small and simple.

## Setup

Use Node 24 (`mise install` reads `mise.toml`), then:

```sh
npm install
npx playwright install chromium
npm run dev:mock
```

## Before you open a pull request

All of these must pass; CI runs the same:

```sh
npm run lint
npm run typecheck
npm test
npm run e2e
npm run build
```

## Rules

- **Tests use the mock only.** Never point tests or local writes at a real MapRoulette, and never
  at production. The mock (`mock/server.ts`) must keep the backend's response shapes; when the
  backend changes, change the mock with it and cite the backend doc.
- **Never log tokens** or other credentials, in code or in test output.
- **No new dependencies** without a reason in the pull request.
- Update `CHANGELOG.md` (under "Unreleased") for user-visible changes.
- One logical change per commit, with a message that says why.

## License

By contributing you agree that your contributions are licensed under the Apache License 2.0.
