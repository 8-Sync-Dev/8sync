import { describe, expect, it } from "vitest";
import { MAIN_TABS, MORE_TABS, barTabs, isMore, moreLabel } from "@/lib/tabs";

describe("HQ tab bar groups", () => {
  it("keeps four daily tabs in the bar (+ Chat phòng while a room is open) and folds the rest, no tab lost or doubled", () => {
    expect(barTabs(false)).toEqual(["overview", "office", "board", "group"]);
    expect(barTabs(true)).toEqual([...MAIN_TABS]);
    const all = [...MAIN_TABS, ...MORE_TABS];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(14);
  });
  it("names the open folded tab on the Thêm button", () => {
    expect(moreLabel("overview")).toBe("Thêm");
    expect(moreLabel("may")).toBe("Máy");
    expect(moreLabel("office3d")).toBe("Văn phòng 3D");
    expect(moreLabel("know")).toBe("Tri thức");
    expect(isMore("board")).toBe(false);
    expect(isMore("activity")).toBe(true);
  });
});
