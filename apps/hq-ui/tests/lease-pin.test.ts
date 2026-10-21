import { afterEach, describe, expect, it, vi } from "vitest";
import { autoText, focusRests, hhmm, leaseText, restText, type AutoState } from "@/lib/auto";
import { parsePins, pinSidebar, sidebarGroups, splitClosed } from "@/lib/sidebar";
import type { Room } from "@/lib/server/office";
import { TOUCH_GAP_MS, touchDue, touchLease } from "@/lib/server/lease-touch";

const NOW = Date.parse("2026-10-21T09:00:00Z");
// The module state lib/server/auto.ts and lib/server/lease-touch.ts keep on globalThis.
const G = globalThis as typeof globalThis & { __hqAutoLast?: unknown; __hqLeaseTouch?: number };

function room(name: string, root: string): Room {
  return {
    key: name,
    name,
    session_id: null,
    label: name,
    status: "idle",
    waiting: null,
    ask: null,
    permit: null,
    cwd: root,
    project: { root, name: root.split(/[/\\]/).pop()!, branch: "main" },
    delivery: null,
    pending: 0,
    inboxLive: false,
    doing: null,
    state: null,
    last_active: null,
    tokens: null,
    model: null,
    usage: null,
    tasks: { done: 0, open: 0 },
    cost_per_task: null,
    seats: [],
    role: null,
    team: null,
    engine: "ccc",
    meeting: null,
  };
}

describe("lease liên tục text", () => {
  const on: AutoState = { on: true, paused: false, lease_until: NOW / 1000 + 3600 };
  it("is silent while the switch is off or 8sync is older", () => {
    expect(leaseText(on)).toBeNull();
    expect(leaseText({ ...on, lease_auto: false })).toBeNull();
  });
  it("says how it renews on each login", () => {
    expect(leaseText({ ...on, lease_auto: true, subscription: true })).toBe("tự gia hạn mỗi lần anh dùng HQ (gói subscription: cần anh có mặt)");
    expect(leaseText({ ...on, lease_auto: true, subscription: false, usd_per_hour: 5 })).toBe("tự gia hạn · ngân sách $5/h");
    expect(leaseText({ ...on, lease_auto: true, subscription: false, usd_per_hour: 2.5 })).toBe("tự gia hạn · ngân sách $2.50/h");
    expect(leaseText({ ...on, lease_auto: true, subscription: true, focus: true })).toContain("usage chặt: chỉ dự án ghim chạy");
  });
  it("says why it rests and until when", () => {
    const until = NOW / 1000 + 1800;
    const rest = { kind: "usage" as const, text: "chạm trần", window: "5h" as const, pct: 91, until };
    expect(restText(rest)).toBe(`nghỉ: usage 5h 91% · chạy lại khi reset ${hhmm(until * 1000)}`);
    expect(restText({ ...rest, until: null })).toBe("nghỉ: usage 5h 91% · chờ usage");
    expect(leaseText({ ...on, lease_auto: true, subscription: true, lease_rest: rest })).toBe(restText(rest));
    // The bar's main line names the window too, not the raw gate sentence.
    expect(autoText({ ...on, gate: "chạm trần gói subscription", lease_rest: rest })).toBe(restText(rest));
    expect(autoText({ ...on, gate: "chạm trần $5.00/giờ", lease_rest: { kind: "budget", text: "chạm trần $5.00/giờ" } })).toBe("Đang nghỉ: chạm trần $5.00/giờ");
  });
});

describe("focusRests", () => {
  const s = { focus: true, pins: ["C:\\code\\zus"] };
  it("rests only unpinned projects while usage is tight", () => {
    expect(focusRests(s, "C:/code/zus/")).toBe(false);
    expect(focusRests(s, "C:\\code\\other")).toBe(true);
    expect(focusRests({ ...s, focus: false }, "C:\\code\\other")).toBe(false);
    expect(focusRests({ focus: true, pins: [] }, "C:\\code\\other")).toBe(false);
  });
});

describe("pinned projects in the sidebar", () => {
  it("parses the pin file oldest first and drops junk", () => {
    expect(parsePins({ "C:\\b": 20, "C:\\a": 10, bad: "x", "": 3 })).toEqual([
      { root: "C:\\a", at: 10 },
      { root: "C:\\b", at: 20 },
    ]);
    expect(parsePins(["C:\\a"])).toEqual([]);
    expect(parsePins(null)).toEqual([]);
  });

  it("puts pinned projects first, keeps a 0-room pinned project, a pinned folder and a closed pinned group", () => {
    const groups = sidebarGroups([room("lead", "C:\\code\\alpha"), room("dev", "C:\\code\\zus"), room("qa", "C:\\code\\closed")], [], NOW);
    const { shown, closed } = splitClosed(groups, [{ key: "c:/code/closed", root: "C:\\code\\closed", name: "closed", hidden_at: NOW + 1 }]);
    const folders = [
      { id: 1, path: "C:\\code\\idle", name: "idle", added_at: 0 },
      { id: 2, path: "C:\\code\\later", name: "later", added_at: 0 },
    ];
    const pins = parsePins({ "C:\\code\\zus": 3, "C:\\code\\idle": 1, "C:\\code\\ghost": 2, "C:\\code\\closed": 4 });
    const side = pinSidebar(pins, shown, closed, folders);
    expect(side.pinned.map((p) => [p.name, p.group ? p.group.rooms.length : p.folder ? "folder" : 0])).toEqual([
      ["idle", "folder"],
      ["ghost", 0],
      ["zus", 1],
      ["closed", 1],
    ]);
    expect(side.shown.map((g) => g.name)).toEqual(["alpha"]);
    expect(side.closed).toEqual([]);
    expect(side.folders.map((f) => f.name)).toEqual(["later"]);
  });

  it("changes nothing with no pins", () => {
    const groups = sidebarGroups([room("lead", "C:\\code\\alpha")], [], NOW);
    const side = pinSidebar([], groups, [], [{ id: 1, path: "C:\\x", name: "x", added_at: 0 }]);
    expect(side.pinned).toEqual([]);
    expect(side.shown.map((g) => g.name)).toEqual(["alpha"]);
    expect(side.folders).toHaveLength(1);
  });
});

describe("renew on an owner POST", () => {
  const post = { method: "POST", origin: "http://127.0.0.1:3000" };
  it("only a browser's mutating request with the switch on, at most every 5 min", () => {
    expect(touchDue(post, true, undefined, NOW)).toBe(true);
    expect(touchDue(post, false, undefined, NOW)).toBe(false);
    expect(touchDue({ method: "GET", origin: post.origin }, true, undefined, NOW)).toBe(false);
    expect(touchDue({ method: "POST", origin: null }, true, undefined, NOW)).toBe(false);
    expect(touchDue(post, true, NOW, NOW + TOUCH_GAP_MS - 1)).toBe(false);
    expect(touchDue(post, true, NOW, NOW + TOUCH_GAP_MS)).toBe(true);
  });

  afterEach(() => {
    delete G.__hqAutoLast;
    delete G.__hqLeaseTouch;
  });

  it("spawns `8sync ccc auto lease renew` once per gap, only when the last status had the switch on", () => {
    const spawn = vi.fn(async () => ({ ok: true, stdout: "", stderr: "" }));
    expect(touchLease(post, NOW, spawn)).toBe(false);
    G.__hqAutoLast = { on: true, paused: false, lease_auto: true };
    expect(touchLease(post, NOW, spawn)).toBe(true);
    expect(touchLease(post, NOW + 60_000, spawn)).toBe(false);
    expect(touchLease(post, NOW + TOUCH_GAP_MS, spawn)).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenCalledWith("8sync", ["ccc", "auto", "lease", "renew", "--json"], 10_000);
  });
});
