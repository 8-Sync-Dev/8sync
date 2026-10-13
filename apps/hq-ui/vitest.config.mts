import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each file gets its own HOME; DB/token caches are keyed by path.
    pool: "forks",
  },
});
