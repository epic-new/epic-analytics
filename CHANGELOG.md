# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-20

### Added

- `currentUser`: an alternative to `currentUserId` that also returns the
  person's `name` and `email`, so Analytics can show people by name. They are
  sent as `x-epic-person` on the `identity` call only, from the server, cut to
  100 and 254 characters. `currentUserId` keeps working unchanged.
- `organization` on `currentUser`, sent as a pseudonym of its id (`org_…`,
  under the same secret) with its name.
- `capture()`: record an event from the server for a signed-in person, under
  the same pseudonym the route uses. Never throws.

## [0.1.2] - 2026-11-16

### Fixed

- The visitor's country reaches Epic again: it is sent as `x-epic-country`
  instead of `x-epic-fwd-<edge header>`, which Epic's own edge could drop
  because it is named after the platform's header.

## [0.1.1] - 2026-11-16

### Changed

- First release published from GitHub Actions with npm trusted publishing and
  provenance. No code changes from 0.1.0.

## [0.1.0] - 2026-11-16

### Added

- `createEpicHandler`: the pipe between Epic's runtime
  and Epic, for any server that speaks the Fetch API.
- `@epicnew/analytics/next`: `createEpicRoute` for a catch-all route handler and
  `<EpicScript />` for the root layout.
- `@epicnew/analytics/otel`: `register` / `registerEpicTracing` for server
  traces through `@vercel/otel`.
- `@epicnew/analytics/browser`: typed `getEpic`, `onEpicReady` and `track` over
  the runtime's page API.

### Security

- Forwards only an allow-list of the browser's own headers; never cookies,
  credentials, addresses or the referrer.
- Sends the token only over https (http only to `localhost`), never along a
  redirect; requires a secret of at least 32 characters.
- Refuses paths outside Epic's relay, cross-site writes, methods other than GET
  and POST, and bodies over 4 MiB.
- Serves Epic's answer only as JSON or a script, with `nosniff`, a sandboxing
  CSP and `Vary: cookie`.
