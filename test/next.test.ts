import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import Script from "next/script";

import { createEpicRoute, EpicScript } from "../src/next";

let epic: ReturnType<typeof Bun.serve>;
const paths: string[] = [];

beforeAll(() => {
  epic = Bun.serve({
    port: 0,
    fetch(request) {
      paths.push(new URL(request.url).pathname);
      return Response.json({ ok: true });
    },
  });
});

afterAll(() => epic.stop(true));
afterEach(() => {
  delete process.env.EPIC_PUBLISHING_TOKEN;
});

describe("createEpicRoute", () => {
  const route = () =>
    createEpicRoute({
      currentUserId: () => null,
      apiUrl: `http://127.0.0.1:${epic.port}`,
      token: "epr_test",
      secret: "s".repeat(32),
    });

  it("forwards the catch-all segments Next.js hands over, awaited as Next 15+ passes them", async () => {
    const { GET } = route();

    const response = await GET(new Request("https://app.example/api/epic/config"), {
      params: Promise.resolve({ path: ["config"] }),
    });

    expect(response.status).toBe(200);
    expect(paths.at(-1)).toBe("/api/replay/v1/relay/config");
  });

  it("accepts the plain params object Next 14 passes", async () => {
    const { POST } = route();

    const response = await POST(
      new Request("https://app.example/api/epic/identity", {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin" },
        body: "{}",
      }),
      { params: { path: ["identity"] } },
    );

    expect(response.status).toBe(200);
    expect(paths.at(-1)).toBe("/api/replay/v1/relay/identity");
  });
});

describe("EpicScript", () => {
  it("renders nothing while the app is not registered with Epic", () => {
    expect(EpicScript()).toBeNull();
  });

  it("loads the runtime through the app's own route once a token is set", () => {
    process.env.EPIC_PUBLISHING_TOKEN = "epr_test";

    const element = EpicScript();

    expect(element?.type).toBe(Script);
    expect(element?.props).toEqual({ src: "/api/epic/runtime.js", strategy: "afterInteractive" });
  });

  it("follows a route mounted elsewhere and an explicit switch", () => {
    expect(EpicScript({ src: "/epic/runtime.js", enabled: true })?.props).toMatchObject({ src: "/epic/runtime.js" });
    process.env.EPIC_PUBLISHING_TOKEN = "epr_test";
    expect(EpicScript({ enabled: false })).toBeNull();
  });
});
