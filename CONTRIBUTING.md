# Contributing

```sh
bun install
bun run test          # unit tests
bun run typecheck
bun run lint          # Biome (bun run format to fix)
bun run build
bun run check:package # publint + are-the-types-wrong on the packed package
bun run test:example  # build and serve examples/nextjs against a stand-in Epic
```

## What belongs here

This package is the part of Epic Analytics that has to run in a customer's app:
their session, their secret, their environment. Anything else — what is
recorded, endpoints, policy, UI — belongs to Epic, where it can change without a
release of this package. A pull request that teaches the route a rule of Epic's
is a sign the change belongs on Epic's side.

The pseudonym formula (`src/core/subject.ts`) and the `x-epic-*` headers are a
contract with Epic and with data already recorded: changing them is a breaking
change.

## Releasing

Releases publish with npm [trusted publishing](https://docs.npmjs.com/trusted-publishers):
no npm token is stored. Once, on npmjs.com, add this repository's
`release.yml` workflow (environment `npm`) as the package's trusted publisher.

1. Update `version` in `package.json` and the `CHANGELOG.md`.
2. Merge to `main`.
3. Publish a GitHub release tagged `v<version>` from `main`. The `release`
   workflow checks the tag, runs every check and publishes with provenance. A
   pre-release publishes under the `next` tag.
