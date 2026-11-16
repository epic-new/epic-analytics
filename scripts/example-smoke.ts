/**
 * End-to-end check: pack the package as npm would, install it in
 * `examples/nextjs`, build that app with Next.js and serve it against a
 * stand-in Epic. Proves what unit tests cannot: that Next's bundler accepts the
 * package, and that a real app relays, names people and exports traces.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const example = join(root, "examples", "nextjs");
const APP_PORT = 3999;

type Received = { method: string; path: string; headers: Record<string, string> };
const received: Received[] = [];

const epic = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    received.push({ method: request.method, path, headers: Object.fromEntries(request.headers) });
    await request.arrayBuffer();
    if (path.endsWith("/runtime.js")) {
      return new Response("window.__epicLoaded = true;", {
        headers: { "content-type": "text/javascript", "cache-control": "private, max-age=60" },
      });
    }
    return Response.json({ ok: true, kind: request.headers.get("x-epic-subject-kind") });
  },
});

let server: ReturnType<typeof spawn> | undefined;
const failures: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures.push(label);
};

try {
  run("bun", ["run", "build"], root);
  for (const file of readdirSync(root)) if (file.endsWith(".tgz")) rmSync(join(root, file));
  run("bun", ["pm", "pack", "--quiet"], root);
  const tarball = readdirSync(root).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("bun pm pack produced no tarball");
  copyFileSync(join(root, tarball), join(example, "epicnew-analytics.tgz"));
  rmSync(join(root, tarball));
  rmSync(join(example, "node_modules", "@epicnew"), { recursive: true, force: true });
  run("bun", ["install", "--no-save"], example);

  const env = {
    ...process.env,
    EPIC_API_URL: `http://127.0.0.1:${epic.port}`,
    EPIC_PUBLISHING_TOKEN: "epr_example",
    EPIC_SECRET: "example-secret-example-secret-123",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  run("bunx", ["next", "build"], example, env);

  server = spawn("bunx", ["next", "start", "-p", String(APP_PORT)], { cwd: example, env, stdio: "ignore" });
  const app = `http://127.0.0.1:${APP_PORT}`;
  await waitFor(async () => (await fetch(app).catch(() => null))?.ok === true, 30_000);

  const page = await (await fetch(app)).text();
  check(page.includes("/api/epic/runtime.js"), "the page loads the runtime through the app's route");

  const runtime = await fetch(`${app}/api/epic/runtime.js`);
  check((await runtime.text()) === "window.__epicLoaded = true;", "runtime.js is relayed from Epic");
  check(runtime.headers.get("cache-control") === "private, max-age=60", "Epic's caching header is relayed");

  const identity = await fetch(`${app}/api/epic/identity`, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", cookie: "demo_user=user-42" },
    body: "{}",
  });
  check((await identity.json()).kind === "user", "a signed-in person reaches Epic as a user");
  const sent = received.find((request) => request.path === "/api/replay/v1/relay/identity");
  check(sent?.headers.authorization === "Bearer epr_example", "the token is added by the server");
  check(/^sub_[\w-]{43}$/.test(sent?.headers["x-epic-subject"] ?? ""), "the person is named by a pseudonym");
  check(!JSON.stringify(sent?.headers ?? {}).includes("user-42"), "the person's id never reaches Epic");

  const crossSite = await fetch(`${app}/api/epic/telemetry`, {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
    body: "{}",
  });
  check(crossSite.status === 403, "a write from another site is refused");

  const traversal = await fetch(`${app}/api/epic/..%2F..%2Fobservability%2Fv1%2Flogs`);
  check(traversal.status === 404, "a path cannot leave the relay namespace");

  const traced = await waitFor(
    async () => received.some((request) => request.path === "/api/observability/v1/traces"),
    20_000,
  ).catch(() => false);
  check(traced !== false, "server traces are exported to Epic");
} finally {
  server?.kill();
  epic.stop(true);
  rmSync(join(example, "epicnew-analytics.tgz"), { force: true });
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nexample works end to end");

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed in ${cwd}`);
}

async function waitFor(condition: () => Promise<boolean> | boolean, timeoutMs: number): Promise<true> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("timed out");
}
