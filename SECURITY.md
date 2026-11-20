# Security

This package sits between your users' browsers and Epic, holding your
publishing token, so we treat any weakness in it as urgent.

## Reporting a vulnerability

Please do **not** open a public issue. Report it privately through GitHub's
[security advisories](https://github.com/epic-new/epic-analytics/security/advisories/new)
for this repository. We acknowledge reports within two business days.

## What the package guarantees

- The publishing token is only ever sent to `EPIC_API_URL`, only over https
  (plain http only to `localhost`), never to the browser, and never along a
  redirect.
- Epic receives a pseudonym of a user id — HMAC-SHA256 under a secret of at
  least 32 characters — never the id itself.
- A name and email reach Epic only when the app's `currentUser` returns them:
  set by the app's server in `x-epic-person`, only on the `identity` call, never
  from the browser (no browser header is forwarded under that name).
- Only an allow-list of the browser's own headers is forwarded (user agent,
  language, client hints, privacy signals, the edge's country). Cookies,
  `Authorization`, IP addresses, the referrer and any other header never are.
- Requests that would leave Epic's relay namespace (`.`/`..` segments) are
  refused before anything is sent.
- Writes are accepted only with `Sec-Fetch-Site: same-origin`; bodies are capped.
- Epic's answer never becomes a document on the app's origin: anything but JSON
  or a script is served as plain text, with `nosniff` and a sandboxing CSP.
- Releases are published from GitHub Actions with npm trusted publishing and
  provenance; no npm token is stored.

## What it does not do

Epic's runtime runs on the app's origin with the reach of the app's own
scripts. Server spans are exported as the app records them; Epic filters them
on receipt.
