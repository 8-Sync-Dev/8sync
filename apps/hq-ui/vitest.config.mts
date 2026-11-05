import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // One temp root per run, removed at the end: tests/global-setup.ts.
    globalSetup: ["tests/global-setup.ts"],
    // Each file gets its own HOME; DB/token caches are keyed by path.
    pool: "forks",
  },
});
