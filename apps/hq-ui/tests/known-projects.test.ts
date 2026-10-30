import { describe, expect, it } from "vitest";
import { mergeKnown } from "@/lib/known-projects";

describe("Dự án trên máy (mergeKnown)", () => {
  it("dedupes by root, drops excluded ones, names by basename, sorts by name", () => {
    const out = mergeKnown(
      [
        { path: "C:/code/zus", source: "session" },
        { path: "c:\\code\\zus\\", source: "claude" },
        { path: "C:/code/8sync", source: "disk" },
        { path: "/srv/app", source: "session" },
        { path: "", source: "x" },
      ],
      ["C:/code/8sync"],
    );
    expect(out).toEqual([
      { path: "/srv/app", name: "app", source: "session" },
      { path: "C:/code/zus", name: "zus", source: "session" },
    ]);
    expect(mergeKnown([], [])).toEqual([]);
  });
});
