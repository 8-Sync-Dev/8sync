import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

// `8sync harness web` writes its per-launch API token here (brand config dir). The dev
// page is Vite's own index (no token meta), so the proxy adds the header itself and
// rewrites Host to the backend's loopback address (the backend refuses other hosts).
function devToken(): string {
  try {
    return readFileSync(join(homedir(), ".config", "8sync", "web-token"), "utf8").trim();
  } catch {
    return "";
  }
}

const api: ProxyOptions = {
  target: "http://127.0.0.1:8731",
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (req) => {
      const t = devToken();
      if (t) req.setHeader("x-8sync-token", t);
      req.removeHeader("origin");
    });
  },
};

// Base "./" so the built SPA works behind the Rust server at any path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
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
