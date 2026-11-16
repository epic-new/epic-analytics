/**
 * What crosses the pipe. These lists are the privacy boundary of the package:
 * they decide what of the visitor's request may reach Epic, and what of Epic's
 * answer may become the app's.
 */

/**
 * The browser's own headers Epic may see: what describes the browser, the
 * device and the person's language and privacy signals. Anything else —
 * cookies, credentials, addresses, whatever a hosting platform adds — never
 * leaves the app, including headers no one has invented yet. The edge's
 * country header is a hint Epic never treats as proof.
 */
const FORWARDED =
  /^(user-agent|accept-language|sec-ch-[a-z-]+|sec-gpc|dnt|save-data|x-vercel-ip-country|cf-ipcountry|cloudfront-viewer-country)$/;

/** Headers that describe the body itself, sent as they are. */
const BODY = new Set(["content-type", "content-encoding"]);

/**
 * Of Epic's answer: what describes the body and its caching, and anything Epic
 * names `x-epic-…`. Epic's own CORS, security and cookie headers never become
 * the app's.
 */
const RELAYED = /^(content-type|cache-control|etag|last-modified|retry-after|vary|x-epic-.*)$/;

/** The browser's request headers as Epic receives them: body headers as is, the rest as `x-epic-fwd-<name>`. */
export function forwardedHeaders(request: Request, into: Headers): void {
  request.headers.forEach((value, name) => {
    if (BODY.has(name)) into.set(name, value);
    else if (FORWARDED.test(name)) into.set(`x-epic-fwd-${name}`, value);
  });
}

/** What Epic answers with: data and scripts, never a document. */
const SERVED_TYPE = /^(application\/(json|javascript)|text\/javascript)\b/i;

/**
 * Epic's answer is served from the app's own origin, so it must never become a
 * document there: anything but JSON or a script (an edge's HTML error page,
 * say) is downgraded to plain text, and the browser told not to guess.
 */
export function relayedHeaders(response: Response): Headers {
  const relayed = new Headers({ "cache-control": "no-store" });
  response.headers.forEach((value, name) => {
    if (RELAYED.test(name)) relayed.set(name, value);
  });
  if (!SERVED_TYPE.test(relayed.get("content-type") ?? "")) relayed.set("content-type", "text/plain; charset=utf-8");
  // The answer depends on who the cookie names; no shared cache may hand it to someone else.
  relayed.append("vary", "cookie");
  relayed.set("x-content-type-options", "nosniff");
  relayed.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'; sandbox");
  return relayed;
}
