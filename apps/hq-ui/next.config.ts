import type { NextConfig } from "next";

/** Never framed (clickjacking), never leaks the URL as a referrer. */
export const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
];

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
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
