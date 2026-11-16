import Script from "next/script";
import { createElement, type ReactElement } from "react";

import { createEpicHandler } from "../core/handler";
import { type EpicHandlerOptions, env } from "../core/options";

export type { CurrentUserId, EpicHandlerOptions } from "../core/options";

type RouteContext = { params?: Promise<{ path?: string[] }> | { path?: string[] } };
type RouteHandler = (request: Request, context?: RouteContext) => Promise<Response>;

/**
 * The route Epic's runtime talks to, for a catch-all route handler.
 *
 * @example
 * ```ts
 * // app/api/epic/[...path]/route.ts
 * import { createEpicRoute } from "@epicnew/analytics/next";
 * import { auth } from "@/auth";
 *
 * export const { GET, POST } = createEpicRoute({
 *   async currentUserId() {
 *     const session = await auth();
 *     return session?.user?.id;
 *   },
 * });
 * ```
 */
export function createEpicRoute(options: EpicHandlerOptions): { GET: RouteHandler; POST: RouteHandler } {
  const epic = createEpicHandler(options);
  const handle: RouteHandler = async (request, context) => epic(request, (await context?.params)?.path);
  return { GET: handle, POST: handle };
}

export interface EpicScriptProps {
  /** Where the route above is mounted, followed by `/runtime.js`. Defaults to `/api/epic/runtime.js`. */
  src?: string;
  /** Whether to load Epic at all. Defaults to whether `EPIC_PUBLISHING_TOKEN` is set. */
  enabled?: boolean;
}

/**
 * Loads Epic's runtime — session replay, its consent prompt and the report
 * button — through the app's own route, after the page is interactive. Place
 * it once, in the root layout.
 *
 * @example
 * ```tsx
 * <body>
 *   {children}
 *   <EpicScript />
 * </body>
 * ```
 */
export function EpicScript({ src = "/api/epic/runtime.js", enabled }: EpicScriptProps = {}): ReactElement | null {
  if (!(enabled ?? Boolean(env("EPIC_PUBLISHING_TOKEN")))) return null;
  return createElement(Script, { src, strategy: "afterInteractive" });
}
