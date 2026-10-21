import { describe, expect, it } from "vitest";
import { evidenceFacts } from "@/components/hq/card-sheet";

describe("Done sheet: facts pulled out of `auto done --evidence` (owner 2026-10-21)", () => {
  it("merge line, release tag and GitHub links; nothing invented", () => {
    const f = evidenceFacts("merged zus-backend#8 @0123abcdef0123456789 · tag v1.7.3 · https://github.com/8-Sync-Dev/zus-backend/pull/8 https://github.com/8-Sync-Dev/zus-backend/releases/tag/v1.7.3 https://github.com/8-Sync-Dev/zus-backend/pull/8");
    expect(f.merged).toBe("zus-backend#8 @0123abcdef01");
    expect(f.tag).toBe("v1.7.3");
    expect(f.links).toEqual(["https://github.com/8-Sync-Dev/zus-backend/pull/8", "https://github.com/8-Sync-Dev/zus-backend/releases/tag/v1.7.3"]);
    expect(evidenceFacts("merged #12")).toMatchObject({ merged: "#12", tag: null, links: [] });
    expect(evidenceFacts("cargo test: 24 passed")).toEqual({ merged: null, tag: null, links: [] });
    expect(evidenceFacts("see https://evil.example/x and version 2.0").links).toEqual([]);
  });
});
