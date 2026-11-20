import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";

import { capture } from "../src";

type Received = { path: string; headers: Record<string, string>; body: unknown };

const SECRET = "s".repeat(32);
let received: Received[] = [];
let status = 200;
let epic: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  epic = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: await request.json(),
      });
      return Response.json({ ok: true }, { status });
    },
  });
});
afterAll(() => epic.stop(true));
beforeEach(() => {
  received = [];
  status = 200;
});

const options = () => ({ apiUrl: `http://127.0.0.1:${epic.port}`, token: "epr_test", secret: SECRET });

describe("capture", () => {
  it("sends the event under the person's pseudonym, with plain properties only", async () => {
    const sent = await capture(
      {
        userId: "user-1",
        event: "subscription_renewed",
        properties: { plan: "pro", seats: 3, trial: false, nested: { a: 1 } as never, "bad key": "x" },
        timestamp: new Date(1_800_000_000_000),
      },
      options(),
    );

    expect(sent).toBe(true);
    expect(received[0]?.path).toBe("/api/replay/v1/relay/events");
    expect(received[0]?.headers["x-epic-subject"]).toBe(
      `sub_${createHmac("sha256", SECRET).update("epic-replay-subject:v1:user:user-1").digest("base64url")}`,
    );
    expect(received[0]?.body).toEqual({
      event: "subscription_renewed",
      properties: { plan: "pro", seats: 3, trial: false },
      timestamp: 1_800_000_000_000,
    });
  });

  it("sends nothing and resolves false for an invalid name or when unconfigured, and never throws", async () => {
    expect(await capture({ userId: "user-1", event: "epic.screen.viewed" }, options())).toBe(false);
    expect(await capture({ userId: "user-1", event: "ok" }, { ...options(), token: "" })).toBe(false);
    expect(await capture({ userId: "user-1", event: "ok" }, { ...options(), apiUrl: "http://example.com" })).toBe(
      false,
    );
    expect(received).toHaveLength(0);

    status = 503;
    expect(await capture({ userId: "user-1", event: "ok" }, options())).toBe(false);
  });
});
