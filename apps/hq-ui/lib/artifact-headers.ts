// Headers of every artifact byte response (app/api/artifacts/[id]/file and /pdf), shared with
// next.config.ts: Next applies the config's headers first and a route's own header of the same name is
// then DROPPED (next/dist/server/send-response.js only appends absent headers), so the per-path config
// rule is what reaches the browser. It must therefore be the full, strict policy, never just the global
// `frame-ancestors 'none'`.

/**
 * Opened straight in a tab (the list's signed `src` is a plain URL), an artifact is an opaque-origin,
 * script-less document: an SVG or HTML file can neither run as HQ nor load anything from elsewhere.
 * `<img>`/`<video>`/`<audio>` in HQ's page are not affected (a subresource's CSP does not apply to it).
 */
export const ARTIFACT_CSP = "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; media-src 'self'; frame-ancestors 'none'";

/** Lower-case names: sendFile sets `x-content-type-options` itself, and a differently cased duplicate would be sent twice. */
export const ARTIFACT_HEADERS: Record<string, string> = {
  "content-security-policy": ARTIFACT_CSP,
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
};

/** Types a browser would run script in when navigated to: only ever handed out inline to the fetches HQ makes itself. */
const ACTIVE_TYPES: Record<string, readonly string[]> = {
  "image/svg+xml": ["image", "empty"], // `<img src>` in HQ, or HQ's own token fetch
  "text/html": ["empty"], // HQ's token fetch → sandboxed srcdoc frame
};

/**
 * How one artifact goes out for a request whose `Sec-Fetch-Dest` is `dest` (null: not a browser, or an
 * old one). An SVG or HTML file asked for as a page, a frame, an object, or by anything unknown is a
 * download of `application/octet-stream`, never a document on HQ's origin.
 */
export function artifactDelivery(type: string, dest: string | null, download: boolean): { type: string; attachment: boolean } {
  const allowed = ACTIVE_TYPES[type.split(";")[0].trim().toLowerCase()];
  if (!allowed) return { type, attachment: download };
  if (download || !dest || !allowed.includes(dest)) return { type: "application/octet-stream", attachment: true };
  return { type, attachment: false };
}
