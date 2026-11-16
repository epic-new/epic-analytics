import { env, secureApiUrl } from "../core/options";

export interface EpicTracingOptions {
  /** Epic's address. Defaults to `EPIC_API_URL`. */
  apiUrl?: string;
  /** This application's publishing token. Defaults to `EPIC_PUBLISHING_TOKEN`. */
  token?: string;
  /** The name spans are reported under. Defaults to `OTEL_SERVICE_NAME`, then `web`. */
  serviceName?: string;
  /** Extra headers sent with each export, for an Epic behind an edge that asks for one. */
  headers?: Record<string, string>;
}

/**
 * Sends the server's OpenTelemetry traces to Epic, which ties a moment of a
 * recorded session to what the server did. Only the exporter is configured
 * here: what a span may keep is decided by Epic when it receives it.
 *
 * Does nothing when Epic is not configured (or its address is not https), on
 * the edge runtime, or with `OTEL_SDK_DISABLED=true`. It turns off Next.js's
 * own fetch spans for the process (`NEXT_OTEL_FETCH_DISABLED`), which would
 * otherwise name the URLs your server calls and carry trace context to them.
 *
 * @example
 * ```ts
 * // instrumentation.ts
 * export { register } from "@epicnew/analytics/otel";
 * ```
 */
export async function registerEpicTracing(options: EpicTracingOptions = {}): Promise<void> {
  const apiUrl = secureApiUrl(options.apiUrl ?? env("EPIC_API_URL"));
  const token = options.token ?? env("EPIC_PUBLISHING_TOKEN");
  if (env("NEXT_RUNTIME") !== "nodejs" || !apiUrl || !token || env("OTEL_SDK_DISABLED") === "true") return;

  // Loaded here, not at the top: the edge runtime also loads instrumentation and cannot load the exporter.
  const { OTLPHttpJsonTraceExporter, registerOTel } = await import("@vercel/otel");
  // A fetch span is named after the URL it calls and would carry trace context to third parties.
  process.env.NEXT_OTEL_FETCH_DISABLED = "1";
  registerOTel({
    serviceName: options.serviceName ?? env("OTEL_SERVICE_NAME") ?? "web",
    instrumentations: [],
    traceExporter: new OTLPHttpJsonTraceExporter({
      url: new URL("/api/observability/v1/traces", apiUrl).toString(),
      headers: { ...options.headers, authorization: `Bearer ${token}` },
    }),
  });
}

/** Next.js's instrumentation hook, with every option from the environment. */
export function register(): Promise<void> {
  return registerEpicTracing();
}
