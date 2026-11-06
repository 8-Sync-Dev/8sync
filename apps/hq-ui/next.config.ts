import type { NextConfig } from "next";
import { ARTIFACT_HEADERS } from "./lib/artifact-headers";
import { PLAY_HEADERS } from "./lib/play-headers";

/** Never framed (clickjacking), never leaks the URL (remote login key) as a referrer, never MIME-sniffed. */
export const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

/**
 * "Chơi thử" files (app/api/play/[key]): sandboxed to an opaque origin, framed by HQ's own page only
 * (lib/play-headers.ts; the route sets the same). A later entry overrides an earlier one for the same key.
 */
export const playFrameHeaders = Object.entries(PLAY_HEADERS).map(([key, value]) => ({ key, value }));

/**
 * Artifact bytes (app/api/artifacts/[id]/file and /pdf) and the room "Thư mục" panel's file bytes
 * (app/api/files/raw): the strict sandbox CSP of lib/artifact-headers.ts.
 * Must be set here: a config header beats the route's header of the same name on the wire.
 */
export const artifactFileHeaders = Object.entries(ARTIFACT_HEADERS).map(([key, value]) => ({ key, value }));

const nextConfig: NextConfig = {
  // Self-contained server.js + traced node_modules: shipped as the hq-ui release asset (scripts/package-hq-ui.sh).
  output: "standalone",
  // The image optimizer pulls in native `sharp`; the asset must stay platform-independent.
  images: { unoptimized: true },
  // Next still traces optional sharp + libvips (.node/.so) into standalone; drop them.
  outputFileTracingExcludes: { "*": ["**/node_modules/sharp/**", "**/node_modules/@img/**", "**/node_modules/.pnpm/sharp*/**", "**/node_modules/.pnpm/@img*/**"] },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/play/:key/:path+", headers: playFrameHeaders },
      { source: "/api/artifacts/:id/file", headers: artifactFileHeaders },
      { source: "/api/artifacts/:id/pdf", headers: artifactFileHeaders },
      { source: "/api/files/raw", headers: artifactFileHeaders },
      { source: "/api/files/pdf", headers: artifactFileHeaders },
    ];
  },
};

export default nextConfig;
