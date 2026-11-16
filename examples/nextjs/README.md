# Next.js example

The smallest app wired to Epic Analytics, and the end-to-end check the package
runs in CI (`bun run test:example` at the repository root): it installs the
packed package, builds this app and serves it against a stand-in Epic.

| File                              | What it adds                              |
| --------------------------------- | ----------------------------------------- |
| `app/api/epic/[...path]/route.ts` | The route Epic's runtime talks to         |
| `app/layout.tsx`                  | `<EpicScript />`, which loads the runtime |
| `instrumentation.ts`              | Server traces to Epic                     |
