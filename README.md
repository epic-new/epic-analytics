<div align="center">

# @epicnew/analytics

**Session replay, bug reports and server traces for your app — through one route on your own domain.**

[![npm](https://img.shields.io/npm/v/@epicnew/analytics?color=000&label=npm)](https://www.npmjs.com/package/@epicnew/analytics)
[![CI](https://github.com/epic-new/epic-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/epic-new/epic-analytics/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-000)](./LICENSE)

[Quickstart](#quickstart) · [Verify](#verify-it-works) · [In your pages](#in-your-pages) · [Other frameworks](#other-frameworks) · [Reference](#reference) · [Troubleshooting](#troubleshooting)

</div>

---

- **Three files, five minutes.** A route, a script tag, an instrumentation hook.
- **Your users stay yours.** Epic never sees a user id, a cookie or an IP address
  — only a pseudonym your server derives with your own secret, and a name and
  email only if you choose to [show people by name](#show-people-by-name).
- **Never out of date.** The recorder, consent prompt and report button are
  served by Epic through your route. Improvements reach your app on its next page
  load, with no upgrade on your side.
- **First-party.** Everything runs through your domain, so ad blockers and
  third-party cookie rules do not get in the way.

## Quickstart

> Next.js App Router. Using something else? See [Other frameworks](#other-frameworks).

### 1. Install

```sh
npm install @epicnew/analytics
```

<sub>or `pnpm add` / `yarn add` / `bun add`</sub>

### 2. Add your keys

In Epic, open **Project → Analytics → Recording settings → Register an application**
and copy the two values it shows. Then generate a secret:

```sh
openssl rand -base64 32
```

```sh
# .env.local — server-only, never NEXT_PUBLIC_
EPIC_API_URL=https://ingest.epic.new
EPIC_PUBLISHING_TOKEN=epr_...
EPIC_SECRET=paste-the-generated-secret   # keep it forever: changing it makes every user new to Epic
```

### 3. Add the route

```ts
// app/api/epic/[...path]/route.ts
import { createEpicRoute } from "@epicnew/analytics/next";
import { auth } from "@/auth"; // your auth library

export const { GET, POST } = createEpicRoute({
  async currentUserId() {
    const session = await auth();
    return session?.user?.id;
  },
});
```

`currentUserId` is the only part that knows your app: return the signed-in
user's id, or nothing for a visitor. [Your auth library ↓](#currentuserid-for-your-auth)

### 4. Load Epic in your layout

```tsx
// app/layout.tsx
import { EpicScript } from "@epicnew/analytics/next";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <EpicScript />
      </body>
    </html>
  );
}
```

### 5. Send server traces <sub>(optional, recommended)</sub>

```ts
// instrumentation.ts — at the project root, next to app/
export { register } from "@epicnew/analytics/otel";
```

Traces tie a moment in a replay to what your server did at that moment.

### 6. Turn it on

Deploy, then switch **Record sessions** on in Epic's recording settings. Visitors
see a consent prompt first; nothing is recorded until they accept (unless you
tell Epic consent is not required).

**That's it.** 🎉

## Verify it works

**From your terminal** — the route should answer with Epic's recording policy:

```sh
curl https://your-app.com/api/epic/config
# {"contractVersion":2,"status":"active", ...}
```

A `{"code":"..."}` error instead? See [Troubleshooting](#troubleshooting).

**In the browser** — open your app, then the devtools console:

```js
window.epicReplay; // the runtime is loaded
epicReplay.consent.recording(); // true once you accepted the prompt
```

Your session shows up in **Analytics → Sessions** within a minute.

## `currentUserId` for your auth

<details open>
<summary><b>Auth.js / NextAuth</b></summary>

```ts
import { auth } from "@/auth";

async currentUserId() {
  const session = await auth();
  return session?.user?.id;
}
```

</details>

<details>
<summary><b>Clerk</b></summary>

```ts
import { auth } from "@clerk/nextjs/server";

async currentUserId() {
  const { userId } = await auth();
  return userId;
}
```

</details>

<details>
<summary><b>Better Auth</b></summary>

```ts
import { headers } from "next/headers";
import { auth } from "@/lib/auth";

async currentUserId() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user.id;
}
```

</details>

<details>
<summary><b>Supabase</b></summary>

```ts
import { createClient } from "@/utils/supabase/server";

async currentUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id;
}
```

</details>

<details>
<summary><b>Your own session</b></summary>

```ts
import { cookies } from "next/headers";
import { readSession } from "@/lib/session";

async currentUserId() {
  const session = await readSession((await cookies()).get("session")?.value);
  return session?.userId;
}
```

</details>

It receives the incoming `Request` if you need it. If it throws, the person is
treated as signed out — your page never fails because of Epic.

## Show people by name

With `currentUserId`, Analytics shows each person by a pseudonym ("User 7f3a").
To see who they are, use `currentUser` instead and return their name and email
along with the id:

```ts
export const { GET, POST } = createEpicRoute({
  async currentUser() {
    const session = await auth();
    const user = session?.user;
    return user && { id: user.id, name: user.name, email: user.email };
  },
});
```

- The id still never reaches Epic: only its pseudonym, as before.
- Name and email are sent from your server, once per page load (the runtime's
  `identity` call), never with recordings, telemetry or reports. The browser
  cannot set or change them.
- Epic stores them encrypted, shows them only to the people who manage the
  project, and replaces them when they change. A manager can remove a person's
  details from their page in Analytics.
- Name is cut to 100 characters, email to 254. Leave both out to keep a person
  pseudonymous.

This makes Epic a processor of that personal data on your behalf; say so where
your privacy policy lists the services you use.

## In your pages

`@epicnew/analytics/browser` gives you a typed handle on the runtime once it has
loaded. Every call is safe before that, and on the server.

```ts
import { onEpicReady, track } from "@epicnew/analytics/browser";

// A marker on the session's timeline
track("checkout.started", { plan: "pro" });

onEpicReady((epic) => {
  epic.consent.grant(); // from your own consent banner
  epic.report.open(); // the bug-report form, from your own button
});
```

<details>
<summary><b>Full runtime API</b></summary>

|                                                          |                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| `event(name, payload?)`                                  | Add a marker to the session                                 |
| `flush()`                                                | Send what is buffered now                                   |
| `getSessionReference()`                                  | The current session, to attach to your own logs or tickets  |
| `consent.grant()` / `consent.withdraw()`                 | Record or stop recording this person                        |
| `consent.status()`                                       | `"granted"`, `"withdrawn"` or `"unknown"`                   |
| `consent.applies()`                                      | Whether there is anything to consent to                     |
| `consent.recording()`                                    | Whether this session is recording                           |
| `consent.subscribe(fn)`                                  | Called on every change; returns an unsubscribe              |
| `report.open()`                                          | Open the report form (`false` if this person cannot report) |
| `report.available()` / `report.onAvailabilityChange(fn)` | Show or hide your own report button                         |

</details>

### Control what is recorded

Add attributes to your HTML — no code needed:

| Attribute          | Effect                                                             |
| ------------------ | ------------------------------------------------------------------ |
| `data-private`     | Never recorded — shows as an empty box in the replay               |
| `data-mask`        | Text recorded as `***`                                             |
| `data-epic-report` | Clicking the element opens the report form                         |
| `data-epic-avoid`  | A fixed bar of yours; Epic's button and prompt move out of its way |

Inputs are masked by default. Passwords are always masked.

### Match your design

Epic's button and prompt read CSS custom properties from
`[data-epic-runtime-ui]`:

```css
[data-epic-runtime-ui] {
  --epic-accent: #6d28d9;
  --epic-accent-fg: #fff;
  --epic-radius: 12px;
  --epic-font: inherit;
  /* also: --epic-fg, --epic-bg, --epic-muted, --epic-border, --epic-danger */
}
```

## Other frameworks

The root entry works on any server that speaks the Fetch API — Node, Bun, Deno,
edge runtimes and Workers.

```ts
import { createEpicHandler } from "@epicnew/analytics";

const epic = createEpicHandler({
  async currentUserId(request) {
    const session = await getSession(request);
    return session?.userId;
  },
});
```

<details open>
<summary><b>Hono</b></summary>

```ts
app.all("/api/epic/*", (c) => epic(c.req.raw));
```

</details>

<details>
<summary><b>Remix / React Router</b></summary>

```ts
// app/routes/api.epic.$.ts
export const loader = ({ request }) => epic(request);
export const action = ({ request }) => epic(request);
```

</details>

<details>
<summary><b>Bun / Deno / Workers</b></summary>

```ts
export default {
  fetch(request: Request) {
    if (new URL(request.url).pathname.startsWith("/api/epic/")) return epic(request);
    return app(request); // your app
  },
};
```

</details>

Then load the runtime once in your pages:

```html
<script src="/api/epic/runtime.js" async></script>
```

Mounted somewhere other than `/api/epic`? Pass `basePath` and point the script
there.

## Reference

### Environment

| Variable                | Required |                                                                |
| ----------------------- | -------- | -------------------------------------------------------------- |
| `EPIC_API_URL`          | ✓        | Epic's address, from the registration                          |
| `EPIC_PUBLISHING_TOKEN` | ✓        | This application's token, from the registration                |
| `EPIC_SECRET`           | ✓        | 32+ characters, yours, never changed                           |
| `EPIC_RELEASE`          |          | The build you are running; defaults to `VERCEL_GIT_COMMIT_SHA` |

### `createEpicRoute(options)` / `createEpicHandler(options)`

| Option            | Default                                  |                                                      |
| ----------------- | ---------------------------------------- | ---------------------------------------------------- |
| `currentUser`     | —                                        | Who is signed in, with name and email (one of these) |
| `currentUserId`   | —                                        | Who is signed in, by id only (one of these)          |
| `apiUrl`          | `EPIC_API_URL`                           |                                                      |
| `token`           | `EPIC_PUBLISHING_TOKEN`                  |                                                      |
| `secret`          | `EPIC_SECRET`                            |                                                      |
| `release`         | `EPIC_RELEASE` → `VERCEL_GIT_COMMIT_SHA` | Lets Epic compare releases                           |
| `basePath`        | `/api/epic`                              | Where the route is mounted                           |
| `secureCookie`    | request is https                         | Visitor cookie `Secure; SameSite=None; Partitioned`  |
| `upstreamHeaders` | —                                        | Extra headers to Epic (e.g. behind a protected edge) |
| `timeoutMs`       | `15000`                                  |                                                      |
| `maxBodyBytes`    | 4 MiB                                    |                                                      |

### `<EpicScript />`

| Prop      | Default                        |                        |
| --------- | ------------------------------ | ---------------------- |
| `src`     | `/api/epic/runtime.js`         | Follow your `basePath` |
| `enabled` | `EPIC_PUBLISHING_TOKEN` is set | Force on or off        |

### `@epicnew/analytics/otel`

`register()` reads the environment. For more control:

```ts
import { registerEpicTracing } from "@epicnew/analytics/otel";

export const register = () => registerEpicTracing({ serviceName: "storefront" });
```

## Troubleshooting

The route answers these itself, without calling Epic:

| You see                 | Why                                       | Fix                                                                          |
| ----------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `503 not_configured`    | A variable is missing                     | Set `EPIC_API_URL`, `EPIC_PUBLISHING_TOKEN` and `EPIC_SECRET`, then redeploy |
| `503 weak_secret`       | `EPIC_SECRET` is under 32 characters      | Generate one with `openssl rand -base64 32`                                  |
| `503 insecure_api_url`  | `EPIC_API_URL` is not https               | Use the https address (http only works for `localhost`)                      |
| `503 unavailable`       | Epic did not answer in time               | Usually transient; check `EPIC_API_URL`                                      |
| `403 cross_origin`      | A write that did not come from your pages | Expected for other sites and very old browsers                               |
| `404 not_found`         | A path outside Epic's relay               | Check the route is at `app/api/epic/[...path]/route.ts`                      |
| `413 payload_too_large` | A body over `maxBodyBytes`                | Raise `maxBodyBytes` if you need to                                          |
| `401` from Epic         | The token was revoked or rotated          | Copy the new token from Epic's settings                                      |

**No consent prompt?** Check recording is on in Epic, that the person is signed
in (or that you allowed visitors in Epic's settings), and that `<EpicScript />`
is in the **root** layout.

**Content Security Policy?** Add `https://ingest.epic.new` to `script-src`.

## How it works

```
 Browser                        Your app                          Epic
 ───────                        ────────                          ────
 Epic runtime ── /api/epic/* ──▶ route ── token + pseudonym ──▶  relay
                                 │  ✓ adds your token (never sent to the browser)
                                 │  ✓ names the user by HMAC(id, EPIC_SECRET)
                                 │  ✗ never forwards cookies, IPs or platform headers
              ◀── JSON / script ─┘  ◀────────────── answer ──────────┘
```

**Privacy & security**

- Only an allow-list of the browser's own headers reaches Epic: user agent,
  language, client hints, privacy signals and your edge's country.
- A person's name and email reach Epic only when `currentUser` returns them,
  only from your server, and only on the `identity` call.
- The token only travels over https, never along a redirect, never to the
  browser.
- Writes must come from your own pages (`Sec-Fetch-Site`); paths cannot leave
  Epic's relay; bodies are capped.
- Epic's answers are served as JSON or scripts only, never as a document on your
  origin.
- Epic's runtime runs on your origin like any analytics or support widget.
  Server traces are sent as your OpenTelemetry SDK records them; Epic keeps an
  allow-list of span fields.
- Use one `EPIC_SECRET` per application.

Found a vulnerability? See [SECURITY.md](./SECURITY.md).

**Cost** — each recording visitor makes about 4–5 requests a minute through your
route (batches every ~20 s, policy every 60 s). On serverless hosting, that is 4–5
function invocations per recording visitor per minute.

## Requirements

- Node.js 18.18+, or any runtime with `fetch` and Web Crypto
- `/next`: Next.js 14.2+ and React 18.2+
- `/otel`: the Node.js runtime

## License

[MIT](./LICENSE)
