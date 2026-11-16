/**
 * The API Epic's runtime exposes in the page, typed. The runtime itself is
 * loaded from Epic (see `EpicScript`), so nothing here records anything: these
 * are thin, typed accessors over `window.epicReplay`.
 */

export type ConsentStatus = "granted" | "withdrawn" | "unknown";

export interface EpicRuntime {
  /** Records a marker on the current session's timeline. */
  event(name: string, payload?: unknown): unknown;
  /** Sends what the recorder holds now. */
  flush(): Promise<void>;
  /** The session being recorded, to attach to your own logs or tickets; null when not recording. */
  getSessionReference(): unknown;
  consent: {
    grant(): void;
    withdraw(): void;
    status(): ConsentStatus | (string & {});
    /** Whether there is anything to consent to: capture is on and this person may be recorded. */
    applies(): boolean;
    /** Whether this person's session records, by their choice or because consent is not required. */
    recording(): boolean;
    /** Calls back whenever the choice or the policy changes; returns the unsubscribe. */
    subscribe(listener: () => void): () => void;
  };
  report: {
    /** Opens the report form; false while this person cannot report. */
    open(): boolean;
    available(): boolean;
    onAvailabilityChange(listener: (available: boolean) => void): () => void;
  };
}

const READY_EVENT = "epic:runtime-ready";

/** The runtime, once it has started in this page; undefined before, on the server, or when Epic is off. */
export function getEpic(): EpicRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { epicReplay?: EpicRuntime }).epicReplay;
}

/**
 * Calls back with the runtime as soon as it is available — at once when it
 * already is. Returns a function that cancels the wait.
 *
 * @example
 * ```ts
 * onEpicReady((epic) => epic.event("checkout.started", { plan: "pro" }));
 * ```
 */
export function onEpicReady(callback: (epic: EpicRuntime) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const ready = getEpic();
  if (ready) {
    callback(ready);
    return () => {};
  }
  const listener = () => {
    const epic = getEpic();
    if (epic) callback(epic);
  };
  window.addEventListener(READY_EVENT, listener, { once: true });
  return () => window.removeEventListener(READY_EVENT, listener);
}

/** Records a marker on the current session; a no-op until the runtime has started. */
export function track(name: string, payload?: unknown): void {
  getEpic()?.event(name, payload);
}
