import { VERSION } from "../version";
import { env, secureApiUrl } from "./options";
import { pseudonymOf } from "./subject";

/** What an event may say: plain values Analytics can filter and count by. */
export type EpicEventProperties = Record<string, string | number | boolean | null | undefined>;

export interface EpicCaptureOptions {
  /** Epic's address. Defaults to `EPIC_API_URL`. */
  apiUrl?: string;
  /** This application's publishing token. Defaults to `EPIC_PUBLISHING_TOKEN`. */
  token?: string;
  /** The same secret the route uses, so the person is the same person. Defaults to `EPIC_SECRET`. */
  secret?: string;
  /** Extra headers sent to Epic, for an Epic behind an edge that asks for one. */
  upstreamHeaders?: Record<string, string>;
  /** How long to wait for Epic. Defaults to 5 seconds. */
  timeoutMs?: number;
}

export interface EpicServerEvent {
  /** Who it happened to: the same id `currentUser` returns. It never reaches Epic, only its pseudonym. */
  userId: string;
  /** What happened, e.g. `subscription_renewed`. Letters, digits and `_ . : -`, up to 64; not `epic.…`. */
  event: string;
  /** Up to 25 plain values. Strings are cut to 200 characters; anything else is dropped. */
  properties?: EpicEventProperties;
  /** When it happened. Defaults to now. */
  timestamp?: Date;
}

const EVENT_NAME = /^(?!epic\.)[A-Za-z0-9_.:-]{1,64}$/;
const PROPERTY_KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const MAX_PROPERTIES = 25;
const MAX_VALUE_LENGTH = 200;

/**
 * Record something that happened on your server, for a signed-in person:
 * a webhook, a renewal, a job that finished. It reaches the same person in
 * Analytics as their pages do.
 *
 * It never throws and never slows a request down for long: it resolves
 * `false` when Epic is not configured, the event is not valid, or Epic did not
 * accept it. Unconfigured, it sends nothing.
 *
 * @example
 * await capture({ userId: user.id, event: "subscription_renewed", properties: { plan: "pro" } });
 */
export async function capture(event: EpicServerEvent, options: EpicCaptureOptions = {}): Promise<boolean> {
  const apiUrl = secureApiUrl(options.apiUrl ?? env("EPIC_API_URL"));
  const token = options.token ?? env("EPIC_PUBLISHING_TOKEN");
  const secret = options.secret ?? env("EPIC_SECRET");
  if (!apiUrl || !token || !secret || secret.length < 32) return false;
  if (!event.userId || !EVENT_NAME.test(event.event)) return false;

  try {
    const response = await fetch(new URL("/api/replay/v1/relay/events", apiUrl), {
      method: "POST",
      headers: {
        ...options.upstreamHeaders,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-epic-sdk": `@epicnew/analytics@${VERSION}`,
        "x-epic-subject": await pseudonymOf("user", event.userId, secret),
        "x-epic-subject-kind": "user",
      },
      body: JSON.stringify({
        event: event.event,
        properties: properties(event.properties),
        timestamp: (event.timestamp ?? new Date()).getTime(),
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeoutMs ?? 5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function properties(input: EpicEventProperties | undefined): Record<string, string | number | boolean> {
  const kept: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (Object.keys(kept).length >= MAX_PROPERTIES) break;
    if (!PROPERTY_KEY.test(key)) continue;
    if (typeof value === "string") kept[key] = Array.from(value).slice(0, MAX_VALUE_LENGTH).join("");
    else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) kept[key] = value;
  }
  return kept;
}
