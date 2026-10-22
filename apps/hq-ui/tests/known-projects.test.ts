import { describe, expect, it } from "vitest";
import { mergeKnown } from "@/lib/known-projects";

describe("Dự án trên máy (mergeKnown)", () => {
  it("dedupes by root, drops excluded ones, names by basename, sorts by name", () => {
    const out = mergeKnown(
      [
        { path: "C:/code/zus", source: "scope" },
        { path: "c:\\code\\zus\\", source: "pin" },
        { path: "C:/code/8sync", source: "team" },
        { path: "/srv/app", source: "session" },
        { path: "", source: "x" },
      ],
      ["C:/code/8sync"],
    );
    expect(out).toEqual([
      { path: "/srv/app", name: "app", source: "session" },
      { path: "C:/code/zus", name: "zus", source: "scope" },
    ]);
    expect(mergeKnown([], [])).toEqual([]);
  });
});
