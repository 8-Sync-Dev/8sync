import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

const BACKEND = "http://127.0.0.1:8731";
const DEV_PORT = 5173;

// `8sync harness web` writes its per-launch API token here (brand config dir). The dev
// page is Vite's own index (no launch URL fragment), so the proxy adds the header itself.
function devToken(): string {
  try {
    return readFileSync(join(homedir(), ".config", "8sync", "web-token"), "utf8").trim();
  } catch {
    return "";
  }
}

// Only this dev page may borrow the token: a loopback Host on the dev port (no
// DNS-rebound name) and no Origin or this same origin (no other site's fetch).
function fromDevPage(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  if (!new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${DEV_PORT}$`).test(host)) return false;
  const origin = req.headers.origin;
  return origin === undefined || origin === `http://${host}`;
}

// Runs before Vite's internal middlewares, so before the proxy below.
const devGuard: Plugin = {
  name: "8sync-dev-api-guard",
  configureServer(server) {
    server.middlewares.use("/api", (req, res, next) => {
      if (fromDevPage(req)) return next();
      res.statusCode = 403;
      res.end("forbidden: not from the 8sync dev page");
    });
  },
};

const api: ProxyOptions = {
  target: BACKEND,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (proxyReq, req) => {
      if (!fromDevPage(req)) return; // devGuard already answered 403
      const t = devToken();
      if (t) proxyReq.setHeader("x-8sync-token", t);
      // The backend accepts writes only with no Origin or its own.
      if (req.headers.origin) proxyReq.setHeader("origin", BACKEND);
    });
  },
};

// Base "./" so the built SPA works behind the Rust server at any path.
export default defineConfig({
  base: "./",
  plugins: [react(), devGuard],
  server: {
    host: "127.0.0.1",
    port: DEV_PORT,
    strictPort: true,
    // Dev server proxies API to the Rust backend.
    proxy: {
      "/api": api,
      "/ws": { target: "ws://127.0.0.1:8731", ws: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
