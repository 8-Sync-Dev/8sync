import { describe, expect, it } from "vitest";
import { MAIN_TABS, MORE_TABS, barTabs, isMore, moreLabel, moreTabs, viewHeader } from "@/lib/tabs";

describe("HQ tab bar groups", () => {
  it("keeps the daily tabs in the bar (+ Chat phòng while a room is open) and folds the rest, no tab lost or doubled", () => {
    expect(barTabs(false)).toEqual(["bots", "workspace", "overview", "office", "preview", "group"]);
    expect(barTabs(true)).toEqual([...MAIN_TABS]);
    const all = [...MAIN_TABS, ...MORE_TABS];
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(17);
  });
  it("names the open folded tab on the Thêm button", () => {
    expect(moreLabel("overview")).toBe("Thêm");
    expect(moreLabel("may")).toBe("Máy");
    expect(moreLabel("loops")).toBe("Vòng lặp");
    expect(moreLabel("know")).toBe("Tri thức");
    expect(moreLabel("artifacts")).toBe("Kết quả");
    expect(moreLabel("sessions")).toBe("Quản lý phiên");
    expect(moreLabel("activity")).toBe("Hoạt động");
    expect(isMore("preview")).toBe(false);
    expect(isMore("activity")).toBe(true);
  });
  it("offers Nội dung only while a content DB is configured", () => {
    expect(moreTabs(false)).not.toContain("content");
    expect(moreTabs(false)).toHaveLength(MORE_TABS.length - 1);
    expect(moreTabs(true)).toContain("content");
  });
  it("heads a view that lists no rooms with its own name, not 'Tất cả phòng' (UAT 2026-11-07)", () => {
    expect(viewHeader("codemap", "su-code")).toEqual({ title: "Bản đồ code", subtitle: "" });
    expect(viewHeader("may", null)).toEqual({ title: "Máy", subtitle: "" });
    expect(viewHeader("preview", "su-code")).toEqual({ title: "Preview", subtitle: "su-code" });
    expect(viewHeader("know", null)).toEqual({ title: "Tri thức", subtitle: "" });
    for (const t of ["overview", "office", "room", "group", "sessions"]) expect(viewHeader(t, "su-code")).toBeNull();
    // Every other tab (Bots/Không gian have their own header in hq-app) gets a name of its own.
    for (const t of [...MAIN_TABS, ...MORE_TABS].filter((t) => !["bots", "workspace", "overview", "office", "room", "group", "sessions"].includes(t))) {
      expect(viewHeader(t, null)?.title).toBeTruthy();
    }
  });
});
