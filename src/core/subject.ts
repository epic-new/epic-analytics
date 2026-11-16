/**
 * How a person is named to Epic. Epic never sees the id: it sees `sub_` and a
 * base64url HMAC-SHA256 of it under the app's secret. The formula is a
 * contract — changing it would make every person new to Epic.
 */

export type SubjectKind = "user" | "visitor";

export const VISITOR_COOKIE = "epic_replay_visitor";
const SUBJECT_DOMAIN = "epic-replay-subject:v1";
const VISITOR_ID = /^[\w-]{43}$/;
const VISITOR_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

export async function pseudonymOf(kind: SubjectKind, id: string, secret: string): Promise<string> {
  const key = keyFor(secret);
  const label = kind === "user" ? "user" : "anonymous";
  const signature = await crypto.subtle.sign("HMAC", await key, encoder.encode(`${SUBJECT_DOMAIN}:${label}:${id}`));
  return `sub_${base64url(new Uint8Array(signature))}`;
}

/** A visitor's id: 32 random bytes. It names nobody, so it needs no signature. */
export function newVisitorId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function visitorIdFrom(request: Request): string | null {
  const value = cookie(request, VISITOR_COOKIE);
  return value && VISITOR_ID.test(value) ? value : null;
}

export function visitorCookie(visitorId: string, path: string, secure: boolean): string {
  const attributes = secure ? "Secure; SameSite=None; Partitioned" : "SameSite=Lax";
  return `${VISITOR_COOKIE}=${visitorId}; Path=${path || "/"}; Max-Age=${VISITOR_MAX_AGE_SECONDS}; HttpOnly; ${attributes}`;
}

function keyFor(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    keys.set(secret, key);
  }
  return key;
}

function cookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
