import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";

import { type CurrentUserId, createEpicHandler, type EpicHandlerOptions } from "../src";

/** The options a test varies, under `currentUserId`; `currentUser` is exercised on its own. */
type IdOptions = Partial<Extract<EpicHandlerOptions, { currentUserId: CurrentUserId }>>;

/**
 * The pipe against a real local server standing in for Epic: what reaches
 * Epic, what the page gets back, and what never leaves the app.
 */

type Received = { method: string; path: string; headers: Record<string, string>; body: string };

const APP = "https://app.example";
const SECRET = "s".repeat(32);
let received: Received[] = [];
let answer: () => Response = () => Response.json({ ok: true });
let epic: ReturnType<typeof Bun.serve>;
let signedIn: string | null = null;

beforeAll(() => {
  epic = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({
        method: request.method,
        path: new URL(request.url).pathname,
        headers: Object.fromEntries(request.headers),
        body: await request.text(),
      });
      return answer();
    },
  });
});

afterAll(() => epic.stop(true));

beforeEach(() => {
  received = [];
  signedIn = null;
  answer = () =>
    Response.json(
      { ok: true },
      {
        headers: {
          "retry-after": "7",
          "x-epic-next": "1",
          "set-cookie": "epic=1",
          "access-control-allow-origin": "*",
          "content-security-policy": "frame-ancestors 'none'",
        },
      },
    );
});

function handler(options: IdOptions = {}) {
  return createEpicHandler({
    currentUserId: () => signedIn,
    apiUrl: `http://127.0.0.1:${epic.port}`,
    token: "epr_test",
    secret: SECRET,
    release: "abc123",
    ...options,
  });
}

function call(method: "GET" | "POST", path: string, headers: Record<string, string> = {}, options: IdOptions = {}) {
  const request = new Request(`${APP}/api/epic/${path}`, {
    method,
    headers:
      method === "POST" ? { "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers } : headers,
    ...(method === "POST" ? { body: '{"a":1}' } : {}),
  });
  return handler(options)(request);
}

/** The pseudonym as the pipe has always derived it, with Node's own crypto. */
function expectedPseudonym(kind: "user" | "anonymous", id: string): string {
  return `sub_${createHmac("sha256", SECRET).update(`epic-replay-subject:v1:${kind}:${id}`).digest("base64url")}`;
}

describe("forwarding", () => {
  it("sends the request to Epic's relay with the token, the pipe's generation and the release", async () => {
    const response = await call("POST", "telemetry");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [sent] = received;
    expect(sent).toMatchObject({ method: "POST", path: "/api/replay/v1/relay/telemetry", body: '{"a":1}' });
    expect(sent?.headers).toMatchObject({
      authorization: "Bearer epr_test",
      "x-epic-pipe": "2",
      "x-epic-release": "abc123",
      "content-type": "application/json",
    });
    expect(sent?.headers["x-epic-sdk"]).toStartWith("@epicnew/analytics@");
  });

  it("forwards the browser's own headers and the country, never cookies, credentials, the address or platform tokens", async () => {
    signedIn = "user-1";

    await call("POST", "telemetry", {
      "user-agent": "Mozilla/5.0 Test",
      "accept-language": "pt-BR",
      cookie: "session=secret-session",
      authorization: "Bearer secret-auth",
      "x-forwarded-for": "203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "true-client-ip": "203.0.113.9",
      "x-vercel-oidc-token": "secret-oidc",
      "cf-connecting-ip": "203.0.113.9",
      "x-vercel-ip-country": "BR",
    });

    const headers = received[0]?.headers ?? {};
    expect(headers["x-epic-fwd-user-agent"]).toBe("Mozilla/5.0 Test");
    expect(headers["x-epic-fwd-accept-language"]).toBe("pt-BR");
    expect(headers["x-epic-country"]).toBe("BR");
    const sent = JSON.stringify(headers);
    for (const leaked of ["user-1", "secret-session", "secret-auth", "secret-oidc", "203.0.113.9"]) {
      expect(sent).not.toContain(leaked);
    }
  });

  it("sends the country only as an exact two-letter code", async () => {
    await call("GET", "config", { "cf-ipcountry": "br" });
    await call("GET", "config", { "x-vercel-ip-country": "BRAZIL" });

    expect(received[0]?.headers["x-epic-country"]).toBe("BR");
    expect(received[1]?.headers["x-epic-country"]).toBeUndefined();
  });

  it("keeps the token when extra upstream headers try to replace it", async () => {
    await call(
      "GET",
      "config",
      {},
      { upstreamHeaders: { authorization: "Bearer other", "x-vercel-protection-bypass": "b" } },
    );

    expect(received[0]?.headers.authorization).toBe("Bearer epr_test");
    expect(received[0]?.headers["x-vercel-protection-bypass"]).toBe("b");
  });

  it("hands back Epic's body and its caching and x-epic-* headers, never Epic's cookies, CORS or security policy", async () => {
    const response = await call("GET", "config");

    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("x-epic-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'; sandbox");
  });

  it("passes Epic's refusal through", async () => {
    answer = () => Response.json({ code: "rate_limited" }, { status: 429 });

    const response = await call("POST", "telemetry");

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ code: "rate_limited" });
  });

  it("reads the path from the URL when the server hands over the request alone", async () => {
    await call("GET", "runtime.js");

    expect(received[0]?.path).toBe("/api/replay/v1/relay/runtime.js");
  });
});

describe("refusals", () => {
  it("refuses a write from another site, or with no proof of its origin, without calling Epic", async () => {
    expect((await call("POST", "telemetry", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await call("POST", "telemetry", { "sec-fetch-site": "same-site" })).status).toBe(403);
    const unmarked = new Request(`${APP}/api/epic/telemetry`, { method: "POST", body: "{}" });
    expect((await handler()(unmarked)).status).toBe(403);
    expect(received).toHaveLength(0);
  });

  it("never walks out of the relay namespace", async () => {
    for (const path of [
      ["..", "..", "observability", "v1", "logs"],
      ["."],
      ["a", "..", "b"],
      [""],
      [],
      ["a/b"],
      ["%2e%2e"],
    ]) {
      const response = await handler()(new Request(`${APP}/api/epic/x`), path);
      expect(response.status, path.join("/")).toBe(404);
    }
    expect((await handler()(new Request(`${APP}/api/epic/%E0%A4%A`))).status).toBe(404);
    expect(received).toHaveLength(0);
  });

  it("answers not_configured and calls nobody when the token, address or secret is missing", async () => {
    for (const missing of [{ token: "" }, { apiUrl: "" }, { secret: "" }]) {
      const response = await call("GET", "config", {}, missing);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: "not_configured" });
    }
    expect(received).toHaveLength(0);
  });

  it("answers unavailable when Epic cannot be reached", async () => {
    const response = await call("GET", "config", {}, { apiUrl: "http://127.0.0.1:9" });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "unavailable" });
  });

  it("never follows a redirect with the token", async () => {
    answer = () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/steal" } });

    const response = await call("GET", "config");

    expect(response.status).toBe(503);
    expect(received).toHaveLength(1);
  });
});

describe("hardening", () => {
  it("never serves Epic's answer as a document on the app's origin", async () => {
    answer = () => new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } });

    const response = await call("GET", "config");

    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("keeps JSON and scripts as Epic typed them", async () => {
    answer = () => new Response("1", { headers: { "content-type": "text/javascript; charset=utf-8" } });
    expect((await call("GET", "runtime.js")).headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    answer = () => Response.json({});
    expect((await call("GET", "config")).headers.get("content-type")).toStartWith("application/json");
  });

  it("forwards only the browser's own headers, so a header no one listed never leaks", async () => {
    await call("POST", "telemetry", {
      "client-ip": "203.0.113.9",
      "wl-proxy-client-ip": "203.0.113.9",
      referer: "https://app.example/reset?token=secret-reset",
      "sec-ch-ua-platform": '"macOS"',
      "sec-gpc": "1",
    });

    const headers = received[0]?.headers ?? {};
    expect(headers["x-epic-fwd-sec-ch-ua-platform"]).toBe('"macOS"');
    expect(headers["x-epic-fwd-sec-gpc"]).toBe("1");
    expect(JSON.stringify(headers)).not.toContain("203.0.113.9");
    expect(JSON.stringify(headers)).not.toContain("secret-reset");
  });

  it("never sends the token in the clear to a remote Epic", async () => {
    const response = await call("GET", "config", {}, { apiUrl: "http://epic.example" });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "insecure_api_url" });
  });

  it("refuses a body over the cap, declared or streamed", async () => {
    expect((await call("POST", "telemetry", {}, { maxBodyBytes: 3 })).status).toBe(413);

    const streamed = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(10)));
        controller.close();
      },
    });
    const request = new Request(`${APP}/api/epic/telemetry`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
      body: streamed,
      duplex: "half",
    } as RequestInit);
    expect((await handler({ maxBodyBytes: 3 })(request)).status).toBe(413);
  });

  it("tells shared caches the answer depends on the visitor's cookie", async () => {
    expect((await call("GET", "config")).headers.get("vary")).toContain("cookie");
  });

  it("answers only GET and POST", async () => {
    const response = await handler()(
      new Request(`${APP}/api/epic/config`, {
        method: "PUT",
        headers: { "sec-fetch-site": "same-origin" },
        body: "{}",
      }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect(received).toHaveLength(0);
  });

  it("refuses to run under a secret too short to protect the pseudonyms", async () => {
    const response = await call("GET", "config", {}, { secret: "short" });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "weak_secret" });
    expect(received).toHaveLength(0);
  });

  it("names nobody when the app's session cannot be read, rather than failing the request", async () => {
    const response = await call(
      "POST",
      "telemetry",
      {},
      {
        currentUserId: () => {
          throw new Error("session store down");
        },
      },
    );

    expect(response.status).toBe(200);
    expect(received[0]?.headers["x-epic-subject"]).toBeUndefined();
  });

  it("forwards nothing for a request outside the route", async () => {
    expect((await handler()(new Request(`${APP}/elsewhere/config`))).status).toBe(404);
    expect(received).toHaveLength(0);
  });
});

describe("who the person is", () => {
  it("names a signed-in person by the same pseudonym the pipe always has, and nothing else", async () => {
    signedIn = "user-1";

    await call("POST", "telemetry");

    expect(received[0]?.headers["x-epic-subject"]).toBe(expectedPseudonym("user", "user-1"));
    expect(received[0]?.headers["x-epic-subject-kind"]).toBe("user");
  });

  it("names nobody when nobody is signed in and the runtime did not ask for a visitor", async () => {
    const response = await call("POST", "identity");

    expect(received[0]?.headers["x-epic-subject"]).toBeUndefined();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("names a visitor once the runtime asks, then by the cookie it set", async () => {
    const minted = await call("POST", "identity", { "x-epic-visitor": "mint" });
    const cookie = minted.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(
      /^epic_replay_visitor=[\w-]{43}; Path=\/api\/epic; Max-Age=2592000; HttpOnly; Secure; SameSite=None; Partitioned$/,
    );
    const visitorId = cookie.split(";")[0]?.split("=")[1] ?? "";

    await call("POST", "reports", { cookie: `other=1; epic_replay_visitor=${visitorId}` });

    expect(received[0]?.headers["x-epic-subject"]).toBe(expectedPseudonym("anonymous", visitorId));
    expect(received[1]?.headers["x-epic-subject"]).toBe(received[0]?.headers["x-epic-subject"]);
    expect(received[1]?.headers["x-epic-subject-kind"]).toBe("visitor");
  });

  it("sets a Lax visitor cookie over plain http, where Secure is impossible", async () => {
    const request = new Request("http://localhost:3000/api/epic/identity", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "x-epic-visitor": "mint" },
      body: "{}",
    });

    const response = await handler()(request);

    expect(response.headers.get("set-cookie")).toEndWith("HttpOnly; SameSite=Lax");
  });

  it("ignores a malformed visitor cookie", async () => {
    await call("POST", "telemetry", { cookie: "epic_replay_visitor=../../etc" });

    expect(received[0]?.headers["x-epic-subject"]).toBeUndefined();
  });

  it("never mints a visitor for a signed-in person, nor names them by a visitor cookie", async () => {
    signedIn = "user-1";

    const response = await call("POST", "identity", {
      "x-epic-visitor": "mint",
      cookie: `epic_replay_visitor=${"v".repeat(43)}`,
    });

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(received[0]?.headers["x-epic-subject-kind"]).toBe("user");
  });

  it("does not mint a second visitor over an existing one", async () => {
    const response = await call("POST", "identity", {
      "x-epic-visitor": "mint",
      cookie: `epic_replay_visitor=${"v".repeat(43)}`,
    });

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(received[0]?.headers["x-epic-subject"]).toBe(expectedPseudonym("anonymous", "v".repeat(43)));
  });
});

describe("showing a person by name", () => {
  function profiled(user: { id: string; name?: string | null; email?: string | null } | null) {
    return createEpicHandler({
      currentUser: () => user,
      apiUrl: `http://127.0.0.1:${epic.port}`,
      token: "epr_test",
      secret: SECRET,
    });
  }

  function post(path: string, headers: Record<string, string> = {}) {
    return new Request(`${APP}/api/epic/${path}`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
      body: "{}",
    });
  }

  function person(header: string | undefined): unknown {
    return header === undefined ? undefined : JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  }

  it("sends the name and email on the identity call, under the same pseudonym as currentUserId", async () => {
    await profiled({ id: "user-1", name: "  Ana Souza ", email: "ana@example.com" })(post("identity"));

    expect(received[0]?.headers["x-epic-subject"]).toBe(expectedPseudonym("user", "user-1"));
    expect(person(received[0]?.headers["x-epic-person"])).toEqual({ name: "Ana Souza", email: "ana@example.com" });
  });

  it("never sends them with telemetry or reports", async () => {
    const handler = profiled({ id: "user-1", name: "Ana", email: "ana@example.com" });
    await handler(post("telemetry"));
    await handler(post("reports"));

    expect(received.map((request) => request.headers["x-epic-person"])).toEqual([undefined, undefined]);
  });

  it("does not let the browser set them", async () => {
    const forged = Buffer.from('{"name":"Someone else"}').toString("base64url");
    await profiled({ id: "user-1" })(post("identity", { "x-epic-person": forged }));
    await profiled(null)(post("identity", { "x-epic-person": forged }));

    expect(received.map((request) => request.headers["x-epic-person"])).toEqual([undefined, undefined]);
  });

  it("cuts an oversized name before sending it, whole characters only", async () => {
    await profiled({ id: "user-1", name: "é".repeat(150) })(post("identity"));

    expect(person(received[0]?.headers["x-epic-person"])).toEqual({ name: "é".repeat(100) });
  });
});

describe("organization on the profile", () => {
  it("sends a pseudonym of the organization's id, never the id, with its name", async () => {
    await createEpicHandler({
      currentUser: () => ({ id: "user-1", name: "Ana", organization: { id: "acme-42", name: "Acme" } }),
      apiUrl: `http://127.0.0.1:${epic.port}`,
      token: "epr_test",
      secret: SECRET,
    })(
      new Request(`${APP}/api/epic/identity`, {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: "{}",
      }),
    );

    const header = received[0]?.headers["x-epic-person"] ?? "";
    const person = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const expected = `org_${createHmac("sha256", SECRET).update("epic-replay-subject:v1:organization:acme-42").digest("base64url")}`;
    expect(person).toEqual({ name: "Ana", organization: { id: expected, name: "Acme" } });
    expect(header).not.toContain("acme-42");
  });
});
