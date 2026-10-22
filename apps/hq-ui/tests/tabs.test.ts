import { describe, expect, it } from "vitest";
import { MAIN_TABS, MORE_TABS, isMore, moreLabel } from "@/lib/tabs";

describe("HQ tab bar groups", () => {
  it("keeps six daily tabs in the bar and folds the rest, no tab lost or doubled", () => {
    expect(MAIN_TABS).toHaveLength(6);
    const all = [...MAIN_TABS, ...MORE_TABS];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(14);
  });
  it("names the open folded tab on the Thêm button", () => {
    expect(moreLabel("overview")).toBe("Thêm");
    expect(moreLabel("may")).toBe("Máy");
    expect(moreLabel("office3d")).toBe("Văn phòng 3D");
    expect(isMore("board")).toBe(false);
    expect(isMore("activity")).toBe(true);
  });
});
