/** Who is signed in for this request: their id, or nothing for nobody. */
export type CurrentUserId = (request: Request) => string | null | undefined | Promise<string | null | undefined>;

export interface EpicHandlerOptions {
  /**
   * Who is signed in, read from your own session. It is the one line that knows
   * your app; Epic never sees the id, only a pseudonym of it.
   *
   * @example
   * async currentUserId() {
   *   const session = await auth();
   *   return session?.user?.id;
   * }
   */
  currentUserId: CurrentUserId;
  /** Epic's address. Defaults to `EPIC_API_URL`. */
  apiUrl?: string;
  /** This application's publishing token. Defaults to `EPIC_PUBLISHING_TOKEN`. */
  token?: string;
  /**
   * The key a person's id is turned into a pseudonym under. Defaults to
   * `EPIC_SECRET`. Keep it stable: changing it makes every person new to Epic.
   */
  secret?: string;
  /** The build this deployment runs. Defaults to `EPIC_RELEASE`, then `VERCEL_GIT_COMMIT_SHA`. */
  release?: string;
  /** Where the route is mounted, which scopes the visitor cookie. Defaults to `/api/epic`. */
  basePath?: string;
  /**
   * Whether the visitor cookie is `Secure` (with `SameSite=None; Partitioned`,
   * so it survives a cross-site frame). Defaults to whether the request
   * arrived over https.
   */
  secureCookie?: boolean;
  /** Extra headers sent to Epic, for an Epic behind an edge that asks for one. */
  upstreamHeaders?: Record<string, string>;
  /** How long to wait for Epic. Defaults to 15 seconds. */
  timeoutMs?: number;
  /** The largest request body forwarded. Defaults to 4 MiB, under serverless platforms' own limits. */
  maxBodyBytes?: number;
}

/** Options win over the environment, read on every request so a runtime env change applies. */
export function resolveOptions(options: EpicHandlerOptions) {
  return {
    currentUserId: options.currentUserId,
    apiUrl: options.apiUrl ?? env("EPIC_API_URL"),
    token: options.token ?? env("EPIC_PUBLISHING_TOKEN"),
    secret: options.secret ?? env("EPIC_SECRET"),
    release: options.release ?? (env("EPIC_RELEASE") || env("VERCEL_GIT_COMMIT_SHA")),
    basePath: (options.basePath ?? "/api/epic").replace(/\/+$/, ""),
    secureCookie: options.secureCookie,
    upstreamHeaders: options.upstreamHeaders ?? {},
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBodyBytes: options.maxBodyBytes ?? 4 * 1024 * 1024,
  };
}

/** `process.env` where there is one; edge runtimes and workers may have none. */
export function env(name: string): string | undefined {
  const value = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
  return value === "" ? undefined : value;
}

/** Epic's address, when it is safe to send the token to: https, or plain http on this machine. */
export function secureApiUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url : null;
  } catch {
    return null;
  }
}
