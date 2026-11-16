import { afterEach, describe, expect, it } from "bun:test";

import { type EpicRuntime, getEpic, onEpicReady, track } from "../src/browser";

/** A page: a window that dispatches events, and the runtime once it starts. */
function page() {
  const window = Object.assign(new EventTarget(), { epicReplay: undefined as EpicRuntime | undefined });
  (globalThis as { window?: unknown }).window = window;
  const events: [string, unknown][] = [];
  const runtime = {
    event: (name: string, payload?: unknown) => events.push([name, payload]),
  } as unknown as EpicRuntime;
  const start = () => {
    window.epicReplay = runtime;
    window.dispatchEvent(new Event("epic:runtime-ready"));
  };
  return { runtime, events, start };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("the runtime's API in the page", () => {
  it("is absent on the server", () => {
    expect(getEpic()).toBeUndefined();
    expect(() => track("x")).not.toThrow();
  });

  it("waits for the runtime to start, then hands it over once", () => {
    const { runtime, start } = page();
    const seen: EpicRuntime[] = [];

    onEpicReady((epic) => seen.push(epic));
    expect(seen).toEqual([]);
    start();
    start();

    expect(seen).toEqual([runtime]);
  });

  it("hands the runtime over at once when it already started, and cancels a wait", () => {
    const { runtime, start } = page();
    const seen: EpicRuntime[] = [];
    const cancel = onEpicReady((epic) => seen.push(epic));
    cancel();
    start();
    expect(seen).toEqual([]);

    onEpicReady((epic) => seen.push(epic));
    expect(seen).toEqual([runtime]);
  });

  it("records a marker only once the runtime runs", () => {
    const { events, start } = page();

    track("before");
    start();
    track("checkout.started", { plan: "pro" });

    expect(events).toEqual([["checkout.started", { plan: "pro" }]]);
  });
});
