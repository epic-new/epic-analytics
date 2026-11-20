import { VERSION } from "../version";
import { forwardedHeaders, relayedHeaders } from "./headers";
import {
  type CurrentUser,
  type CurrentUserProfile,
  type EpicHandlerOptions,
  resolveOptions,
  secureApiUrl,
} from "./options";
import { newVisitorId, organizationPseudonymOf, pseudonymOf, visitorCookie, visitorIdFrom } from "./subject";

/** The generation of the pipe contract Epic reads in `x-epic-pipe`. */
const PIPE_CONTRACT = "2";

/** The shortest secret the pseudonym is derived under. */
const MIN_SECRET_LENGTH = 32;

/**
 * A path segment Epic's relay can name: plain words, `runtime.js` included —
 * never `.` or `..`, which would walk out of the relay onto endpoints the token
 * also opens.
 */
const SEGMENT = /^(?!\.+$)[\w.-]{1,64}$/;

/** A request from the page, answered with Epic's response. */
export type EpicHandler = (request: Request, path?: string[]) => Promise<Response>;

/**
 * The app's one door to Epic, for any server that speaks the Fetch API
 * (Next.js, Remix, Hono, Bun, Workers). Epic's runtime in the page calls
 * `<basePath>/<path>`; this forwards the request to Epic with the publishing
 * token and a pseudonym of the person, and hands back Epic's answer.
 *
 * It knows no endpoint or policy of Epic's, so nothing Epic adds or changes
 * needs a new version of this package.
 *
 * Unconfigured (no API URL, token or secret), every call answers 503 and the
 * app works as if Epic did not exist.
 *
 * @example
 * const epic = createEpicHandler({
 *   async currentUserId(request) {
 *     const session = await getSession(request);
 *     return session?.userId;
 *   },
 * });
 * app.all("/api/epic/*", (c) => epic(c.req.raw));
 */
export function createEpicHandler(options: EpicHandlerOptions): EpicHandler {
  return (request, path) => handle(request, options, path);
}

async function handle(request: Request, options: EpicHandlerOptions, path?: string[]): Promise<Response> {
  const config = resolveOptions(options);
  if (!config.apiUrl || !config.token || !config.secret) return failure("not_configured", 503);
  // The token is never sent in the clear: Epic's address must be https (or this machine, in development).
  const apiUrl = secureApiUrl(config.apiUrl);
  if (!apiUrl) return failure("insecure_api_url", 503);
  // A short secret would let anyone holding pseudonyms guess the ids behind them.
  if (config.secret.length < MIN_SECRET_LENGTH) return failure("weak_secret", 503);
  if (request.method !== "GET" && request.method !== "POST") {
    return failure("method_not_allowed", 405, { allow: "GET, POST" });
  }
  // A page of another site must not send data in the visitor's name.
  if (request.method === "POST" && request.headers.get("sec-fetch-site") !== "same-origin") {
    return failure("cross_origin", 403);
  }
  if (Number(request.headers.get("content-length")) > config.maxBodyBytes) return failure("payload_too_large", 413);
  const segments = path ?? pathOf(request, config.basePath);
  if (segments.length === 0 || !segments.every((segment) => SEGMENT.test(segment))) return failure("not_found", 404);

  const headers = new Headers({
    ...config.upstreamHeaders,
    authorization: `Bearer ${config.token}`,
    "x-epic-pipe": PIPE_CONTRACT,
    "x-epic-sdk": `@epicnew/analytics@${VERSION}`,
  });
  forwardedHeaders(request, headers);
  if (config.release) headers.set("x-epic-release", config.release);

  const user = await signedIn(config.currentUser, request);
  const userId = user?.id ?? null;
  let visitorId = userId ? null : visitorIdFrom(request);
  // The runtime asks for a visitor only where the environment's policy lets visitors take part.
  const minted = !userId && !visitorId && request.headers.get("x-epic-visitor") === "mint";
  if (minted) visitorId = newVisitorId();
  const subject = userId
    ? ({ kind: "user", id: userId } as const)
    : visitorId
      ? ({ kind: "visitor", id: visitorId } as const)
      : null;
  if (subject) {
    headers.set("x-epic-subject", await pseudonymOf(subject.kind, subject.id, config.secret));
    headers.set("x-epic-subject-kind", subject.kind);
  }
  // Once per page load, never with telemetry or reports: the profile travels only where Epic records it.
  const person =
    user && request.method === "POST" && segments.join("/") === "identity"
      ? await personHeader(user, config.secret)
      : null;
  if (person) headers.set("x-epic-person", person);

  const body = request.body ? bounded(request.body, config.maxBodyBytes) : null;
  let response: Response;
  try {
    const target = segments.map(encodeURIComponent).join("/");
    response = await fetch(new URL(`/api/replay/v1/relay/${target}`, apiUrl), {
      method: request.method,
      headers,
      ...(body ? { body: body.stream, duplex: "half" } : {}),
      // The token must never follow a redirect to another host.
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    } as RequestInit);
  } catch {
    return body?.exceeded() ? failure("payload_too_large", 413) : failure("unavailable", 503);
  }

  const relayed = relayedHeaders(response);
  if (minted && visitorId) {
    relayed.set("set-cookie", visitorCookie(visitorId, config.basePath, config.secureCookie ?? isHttps(request)));
  }
  return new Response(response.body, { status: response.status, headers: relayed });
}

/** The segments after `basePath`, for a server that hands over the request alone; none outside it. */
function pathOf(request: Request, basePath: string): string[] {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${basePath}/`)) return [];
  try {
    return pathname
      .slice(basePath.length + 1)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch {
    return [];
  }
}

/** The body as it streams, cut off the moment it passes the cap rather than trusting `Content-Length`. */
function bounded(stream: ReadableStream<Uint8Array>, maxBytes: number) {
  let total = 0;
  return {
    stream: stream.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > maxBytes) controller.error(new Error("payload_too_large"));
          else controller.enqueue(chunk);
        },
      }),
    ),
    exceeded: () => total > maxBytes,
  };
}

/** The signed-in user; a session that cannot be read names nobody rather than failing the page's request. */
async function signedIn(currentUser: CurrentUser, request: Request): Promise<CurrentUserProfile | null> {
  try {
    const user = await currentUser(request);
    return user?.id ? user : null;
  } catch {
    return null;
  }
}

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;

/**
 * The name, email and organization Epic may show for this person, as
 * base64url JSON, or null when the app gave none. Epic validates it again; cutting it here only
 * keeps an oversized value from being sent at all.
 */
async function personHeader(user: CurrentUserProfile, secret: string): Promise<string | null> {
  const name = text(user.name, MAX_NAME_LENGTH);
  const email = text(user.email, MAX_EMAIL_LENGTH);
  const organizationId = text(user.organization?.id, 256);
  const organizationName = text(user.organization?.name, MAX_NAME_LENGTH);
  const organization = organizationId
    ? {
        id: await organizationPseudonymOf(organizationId, secret),
        ...(organizationName ? { name: organizationName } : {}),
      }
    : null;
  if (!name && !email && !organization) return null;
  const json = JSON.stringify({
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(organization ? { organization } : {}),
  });
  let binary = "";
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function text(value: string | null | undefined, max: number): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? Array.from(trimmed).slice(0, max).join("") : null;
}

function isHttps(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return (forwarded ?? new URL(request.url).protocol.replace(":", "")) === "https";
}

function failure(code: string, status: number, headers: Record<string, string> = {}): Response {
  return Response.json({ error: code, code }, { status, headers: { "cache-control": "no-store", ...headers } });
}
