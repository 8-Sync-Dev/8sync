import { describe, expect, it } from "vitest";
import { MORE_TABS, NAV, isMore, moreLabel, moreTabs, navOf, viewHeader } from "@/lib/tabs";

describe("HQ navigation (owner 2026-11-07: Bots · Nhóm · Tìm · Thêm)", () => {
  it("has four places, and every older tab id still has a home under Thêm", () => {
    expect([...NAV]).toEqual(["bots", "groups", "search", "more"]);
    const old = ["workspace", "overview", "office", "preview", "group", "room", "artifacts", "codemap", "know", "content", "loops", "report", "usage", "may", "sessions", "activity"];
    for (const t of old) {
      expect(isMore(t)).toBe(true);
      expect(navOf(t)).toBe("more");
    }
    expect(new Set(MORE_TABS).size).toBe(MORE_TABS.length);
    expect(navOf("bots")).toBe("bots");
    expect(navOf("groups")).toBe("groups");
    expect(navOf("search")).toBe("search");
  });
  it("names the open view on the Thêm item", () => {
    expect(moreLabel("bots")).toBe("Thêm");
    expect(moreLabel("may")).toBe("Máy");
    expect(moreLabel("overview")).toBe("Tổng quan");
  });
  it("offers Nội dung only with a content DB and Chat phòng only while a room is open", () => {
    expect(moreTabs(false, false)).not.toContain("content");
    expect(moreTabs(false, false)).not.toContain("room");
    expect(moreTabs(true, true)).toEqual([...MORE_TABS]);
    expect(moreTabs(false, true)).toHaveLength(MORE_TABS.length - 1);
  });
  it("heads a view that lists no rooms with its own name, not 'Tất cả phòng' (UAT 2026-11-07)", () => {
    expect(viewHeader("codemap", "su-code")).toEqual({ title: "Bản đồ code", subtitle: "" });
    expect(viewHeader("preview", "su-code")).toEqual({ title: "Preview", subtitle: "su-code" });
    expect(viewHeader("search", null)).toEqual({ title: "Tìm", subtitle: "" });
    for (const t of ["overview", "office", "room", "group", "sessions"]) expect(viewHeader(t, "su-code")).toBeNull();
    for (const t of MORE_TABS.filter((t) => !["overview", "office", "room", "group", "sessions"].includes(t))) {
      expect(viewHeader(t, null)?.title).toBeTruthy();
    }
  });
});
