import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withMissing } from "@/lib/server/db";

describe("withMissing", () => {
  it("flags projects whose folder is gone, keeps every row", () => {
    const here = fs.mkdtempSync(path.join(os.tmpdir(), "hq-proj-"));
    const gone = path.join(here, "deleted-uat");
    const out = withMissing([
      { id: 1, path: here },
      { id: 2, path: gone },
    ]);
    expect(out).toEqual([
      { id: 1, path: here, missing: false },
      { id: 2, path: gone, missing: true },
    ]);
    fs.rmSync(here, { recursive: true });
  });
  it("uses the injected check", () => {
    expect(withMissing([{ path: "/x" }], () => true)[0].missing).toBe(false);
  });
});
