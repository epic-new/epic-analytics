/**
 * `@epicnew/analytics` — connect an app to Epic Analytics.
 *
 * The root entry is framework-agnostic and runs wherever the Fetch API does.
 * Framework entries build on it: `@epicnew/analytics/next` for Next.js,
 * `@epicnew/analytics/otel` for server traces, `@epicnew/analytics/browser`
 * for the runtime's API in the page.
 */
export { createEpicHandler, type EpicHandler } from "./core/handler";
export type { CurrentUserId, EpicHandlerOptions } from "./core/options";
export { VERSION } from "./version";
