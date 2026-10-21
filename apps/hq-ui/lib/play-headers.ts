// Headers of every "Chơi thử" file response (app/api/play/[key]/[[...path]]), shared with next.config.ts
// so the config's per-path rule and the route never disagree. The game runs in an OPAQUE origin: the
// CSP sandbox has no allow-same-origin, so a script in dist/ can neither read HQ's page (and its token)
// nor reach window.parent. Its own module scripts and fetches are then CORS requests from `null`,
// hence `Access-Control-Allow-Origin: *` (no credentials are ever involved: the lock is the path).
export const PLAY_SANDBOX = "allow-scripts allow-pointer-lock allow-popups allow-forms";

export const PLAY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": `sandbox ${PLAY_SANDBOX}; frame-ancestors 'self'`,
  "X-Frame-Options": "SAMEORIGIN",
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
};
