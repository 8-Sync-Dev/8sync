import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dbPath, journalFiles } from "@/lib/server/paths";

// Regression: on Windows the suite once wrote into the owner's real HQ journal and DB.
describe("test isolation", () => {
  it("every state path is under the temp dir, never the real home", () => {
    const tmp = path.resolve(os.tmpdir());
    for (const p of [dbPath(), journalFiles().current, journalFiles().rotated, os.homedir()]) {
      expect(path.resolve(p).startsWith(tmp), p).toBe(true);
    }
  });
});
