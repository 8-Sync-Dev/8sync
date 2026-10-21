import { describe, expect, it } from "vitest";
import {
  ALL_PROJECTS,
  broadcastProjects,
  broadcastSummary,
  choiceValid,
  defaultChoice,
  isSendKey,
  pickedProjects,
  resolveChoice,
  resultLine,
  sendOutcome,
} from "@/lib/broadcast";

const room = (label: string, root: string | null, branch: string | null = "main", cwd: string | null = root) => ({
  key: label,
  label,
  cwd,
  project: root ? { root, name: root.split("/").pop()!, branch } : null,
});

const rooms = [room("rd", "/w/shop"), room("web", "/w/shop"), room("qa", "/w/shop"), room("ops", "/w/tools", null), room("tmp", null, null, "/tmp/x"), room("ghost", null, null, null)];

describe("broadcast composer rules", () => {
  it("groups live rooms by project, busiest first, branch in the name, cwd when no git root", () => {
    expect(broadcastProjects(rooms)).toEqual([
      { root: "/w/shop", name: "shop ⎇ main", rooms: ["rd", "web", "qa"] },
      { root: "/w/tools", name: "tools", rooms: ["ops"] },
      { root: "/tmp/x", name: "x", rooms: ["tmp"] },
    ]);
  });

  it("defaults to the project in scope, else the busiest; nothing when no room", () => {
    const ps = broadcastProjects(rooms);
    expect(defaultChoice(ps, "/W/TOOLS")).toBe("/w/tools");
    expect(defaultChoice(ps, "/w/tools/")).toBe("/w/tools");
    // A Windows repo picked in the sidebar is written with backslashes / `\\?\\` (2026-10-21: the
    // box under "platform" offered the busiest project, ide, and its lead).
    const win = broadcastProjects([
      { key: "a", label: "lead-ide", cwd: null, project: { root: "C:/Users/P/startup/zus/ide", name: "ide", branch: "zus-work" } },
      { key: "b", label: "dev-ide", cwd: null, project: { root: "C:/Users/P/startup/zus/ide", name: "ide", branch: "zus-work" } },
      { key: "c", label: "lead", cwd: null, project: { root: "C:\\Users\\P\\startup\\8sync\\platform", name: "platform", branch: "main" } },
    ]);
    expect(defaultChoice(win, "C:\\Users\\P\\startup\\8sync\\platform")).toBe("C:\\Users\\P\\startup\\8sync\\platform");
    expect(defaultChoice(win, "\\\\?\\c:\\users\\p\\startup\\8sync\\platform\\")).toBe("C:\\Users\\P\\startup\\8sync\\platform");
    expect(defaultChoice(win, "c:/users/p/startup/8sync/platform")).toBe("C:\\Users\\P\\startup\\8sync\\platform");
    expect(defaultChoice(ps, "/nowhere")).toBe("/w/shop");
    expect(defaultChoice(ps)).toBe("/w/shop");
    expect(defaultChoice([])).toBe("");
    expect(pickedProjects(ALL_PROJECTS, ps)).toHaveLength(3);
  });

  it("keeps the owner's pick while it exists, falls back when its project lost every room", () => {
    const ps = broadcastProjects(rooms);
    expect(resolveChoice("/w/tools", ps, "/w/shop")).toBe("/w/tools");
    expect(resolveChoice(null, ps, "/w/tools")).toBe("/w/tools");
    const gone = ps.filter((p) => p.root !== "/w/tools");
    expect(choiceValid("/w/tools", gone)).toBe(false);
    expect(resolveChoice("/w/tools", gone, null)).toBe("/w/shop");
    // "Mọi dự án" needs two projects; with one left it falls back to that project.
    expect(resolveChoice(ALL_PROJECTS, ps)).toBe(ALL_PROJECTS);
    expect(resolveChoice(ALL_PROJECTS, ps.slice(0, 1))).toBe("/w/shop");
    expect(resolveChoice("", [])).toBe("");
  });

  it("counts worktree rooms under their repo and a nested repo as its own project (owner 2026-10-18: 3 of 8 rooms)", () => {
    const game = "/s/startup/game/ai";
    const ps = broadcastProjects([
      room("lead", game),
      room("ba", game),
      room("arch", `${game}/.claude/worktrees/arch-radar`, "arch-radar"),
      room("ui", `${game}/.claude/worktrees/card-29`, "card-29"),
      room("qa", "/s/startup"),
    ]);
    expect(ps.map((p) => [p.root, p.rooms.length])).toEqual([
      [game, 4],
      ["/s/startup", 1],
    ]);
    expect(pickedProjects(ALL_PROJECTS, ps).flatMap((p) => p.rooms)).toHaveLength(5);
    expect(broadcastSummary(game, ps, true)).toMatch(/^Gửi ngay cho tối đa 4 phòng trong ai ⎇ main: lead, ba, arch, ui\./);
    expect(broadcastSummary(ALL_PROJECTS, ps, true)).toMatch(/^Gửi ngay cho tối đa 5 phòng ở 2 dự án/);
  });

  it("the summary says how many rooms at most, where, and when they take it", () => {
    const ps = broadcastProjects(rooms);
    expect(broadcastSummary("/w/shop", ps, true)).toBe(
      "Gửi ngay cho tối đa 3 phòng trong shop ⎇ main: rd, web, qa. Phòng mở bằng `8sync ccc .` nhận ngay, phòng đang bận nhận khi xong lượt.",
    );
    expect(broadcastSummary(ALL_PROJECTS, ps, true)).toMatch(/^Gửi ngay cho tối đa 5 phòng ở 3 dự án: rd, web, qa, ops \+1\./);
    expect(broadcastSummary("/w/tools", ps, false)).toBe("Vào hàng đích trong tools (1 phòng): các phòng làm khi tới lượt, lúc auto đang chạy.");
    expect(broadcastSummary("", [], true)).toMatch(/Chưa có phòng nào đang chạy.*8sync ccc \. <tên>/);
  });

  it("result lines name each room and how it receives the task", () => {
    const base = { name: "shop", ok: true, id: 12, error: null };
    expect(resultLine({ ...base, sent: [{ name: "rd", now: true }, { name: "web", now: false }] }, true)).toBe(
      "shop: đích #12 đã gửi 2 phòng (nhận ngay khi rảnh: rd; nhận khi xong lượt: web)",
    );
    expect(resultLine({ ...base, sent: [] }, true)).toMatch(/đã vào hàng, nhưng dự án chưa có phòng mở bằng/);
    expect(resultLine({ ...base, sent: [] }, false)).toBe("shop: đích #12 đã vào hàng");
    expect(resultLine({ ...base, ok: false, id: null, sent: [], error: "boom" }, true)).toBe("shop: chưa gửi được (boom)");
  });

  it("a partial failure keeps the text and names the projects to send again", () => {
    const ok = { name: "shop", ok: true, id: 1, error: null, sent: [{ name: "rd", now: true }] };
    const bad = { name: "tools", ok: false, id: null, error: "x", sent: [] };
    expect(sendOutcome([ok, ok])).toEqual({ clear: true, failed: [], sent: 2 });
    expect(sendOutcome([ok, bad])).toEqual({ clear: false, failed: ["tools"], sent: 1 });
    expect(sendOutcome([bad])).toEqual({ clear: false, failed: ["tools"], sent: 0 });
    expect(sendOutcome([]).clear).toBe(false);
  });

  it("only Ctrl/Cmd+Enter sends; plain Enter and IME composition do not", () => {
    const k = (o: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }>) => ({ key: "Enter", ctrlKey: false, metaKey: false, isComposing: false, ...o });
    expect(isSendKey(k({}))).toBe(false);
    expect(isSendKey(k({ ctrlKey: true }))).toBe(true);
    expect(isSendKey(k({ metaKey: true }))).toBe(true);
    expect(isSendKey(k({ ctrlKey: true, isComposing: true }))).toBe(false);
    expect(isSendKey(k({ key: "a", ctrlKey: true }))).toBe(false);
  });
});
