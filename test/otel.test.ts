import { afterEach, describe, expect, it } from "bun:test";

import { registerEpicTracing } from "../src/otel";

afterEach(() => {
  delete process.env.NEXT_RUNTIME;
  delete process.env.NEXT_OTEL_FETCH_DISABLED;
});

describe("registerEpicTracing", () => {
  it("does nothing outside the Node.js runtime, without Epic, or when OpenTelemetry is off", async () => {
    await registerEpicTracing({ apiUrl: "https://ingest.example", token: "epr_test" });
    process.env.NEXT_RUNTIME = "nodejs";
    await registerEpicTracing({ apiUrl: undefined, token: undefined });
    process.env.OTEL_SDK_DISABLED = "true";
    await registerEpicTracing({ apiUrl: "https://ingest.example", token: "epr_test" });
    delete process.env.OTEL_SDK_DISABLED;

    expect(process.env.NEXT_OTEL_FETCH_DISABLED).toBeUndefined();
  });

  it("registers the exporter and keeps fetch spans off on the Node.js runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";

    await registerEpicTracing({ apiUrl: "https://ingest.example", token: "epr_test", serviceName: "test" });

    expect(process.env.NEXT_OTEL_FETCH_DISABLED).toBe("1");
  });
});
