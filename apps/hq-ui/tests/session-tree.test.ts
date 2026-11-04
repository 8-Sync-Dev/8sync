import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { replacePane, type WorkspaceState } from "@/lib/omp-workspace";
import {
  byState,
  cycleKey,
  finishedSince,
  groupSessions,
  isUnread,
  mergeSessions,
  moveKey,
  readArchive,
  readOrder,
  readPrefs,
  sessionNameFrom,
  sortSessions,
  splitChildren,
  toggle,
  treeStateOfFloor,
  type OmpTreeRow,
  type TreeChild,
  type TreeRoomIn,
  type TreeSession,
} from "@/lib/session-tree";
import { ompChildren, registryCreated } from "@/lib/server/omp-tree";

const S = (o: Partial<TreeSession> & { key: string }): TreeSession => ({
  kind: "omp",
  title: o.key,
  name: o.key,
  root: "C:\\code\\app",
  folder: "app",
  worktree: null,
  state: "idle",
  at: null,
  created: null,
  doing: null,
  ompId: o.key,
  cwd: "C:\\code\\app",
  room: null,
  children: [],
  ...o,
});

const room = (o: Partial<TreeRoomIn> & { key: string }): TreeRoomIn => ({
  name: o.key,
  session_id: null,
  label: o.key,
  status: "running",
  waiting: null,
  cwd: "C:\\code\\app",
  project: { root: "C:\\code\\app", name: "app" },
  state: null,
  doing: null,
  last_active: 1000,
  engine: "ccc",
  seats: [],
  ...o,
});

const omp = (o: Partial<OmpTreeRow> & { id: string }): OmpTreeRow => ({
  name: o.id,
  title: null,
  cwd: "C:\\code\\app",
  state: "idle",
  doing: null,
  last_active: 500,
  created: 100,
  children: [],
  ...o,
});

describe("treeStateOfFloor", () => {
  it("maps desk states to the five tree states", () => {
    expect(treeStateOfFloor("waiting")).toBe("needs");
    expect(treeStateOfFloor("stalled")).toBe("error");
    expect(treeStateOfFloor("done")).toBe("done");
    for (const s of ["typing", "running", "reading", "meeting"]) expect(treeStateOfFloor(s)).toBe("working");
    expect(treeStateOfFloor("idle")).toBe("idle");
    expect(treeStateOfFloor(null)).toBe("idle");
  });
});

describe("mergeSessions", () => {
  it("shows an omp room once, with the room's 'chờ anh' and key", () => {
    const list = mergeSessions([room({ key: "r1", engine: "omp", session_id: "omp-aaaaaaaaaaaaaaaa", status: "needs_input", last_active: 900 })], [omp({ id: "omp-aaaaaaaaaaaaaaaa", name: "fix", title: "Fix login" })]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ key: "omp-aaaaaaaaaaaaaaaa", title: "Fix login", state: "needs", room: "r1", ompId: "omp-aaaaaaaaaaaaaaaa", at: 900, created: 100 });
  });

  it("folds a worktree under its repo and turns a ccc room's running agents into sub-sessions", () => {
    const wt = "C:\\code\\app\\.claude\\worktrees\\ui";
    const list = mergeSessions([room({ key: "lead", cwd: wt, project: { root: wt, name: "ui" }, seats: [{ key: "lead", active: ["lead"] }, { key: "explore", active: ["Explore", "Plan"] }] })], []);
    expect(list[0]).toMatchObject({ root: "C:\\code\\app", folder: "app", worktree: "ui", kind: "ccc", ompId: null, room: "lead" });
    expect(list[0].children.map((c) => c.title)).toEqual(["Explore", "Plan"]);
  });

  it("drops ended rooms and maps stalled rooms to Lỗi", () => {
    const list = mergeSessions([room({ key: "a", status: "ended" }), room({ key: "b", state: "stalled", status: "idle" })], []);
    expect(list.map((s) => [s.key, s.state])).toEqual([["b", "error"]]);
  });
});

describe("groupSessions / sortSessions", () => {
  const list = [
    S({ key: "a", title: "beta", at: 10, created: 300 }),
    S({ key: "b", title: "Alpha", at: 30, created: 100, state: "working" }),
    S({ key: "c", title: "gamma", at: 50, root: "C:\\code\\web", folder: "web", state: "needs" }),
    S({ key: "d", title: "delta", at: null, root: null, folder: "Không rõ thư mục" }),
  ];

  it("sorts by recent, created (falling back to activity) and name", () => {
    expect(sortSessions(list, "recent").map((s) => s.key)).toEqual(["c", "b", "a", "d"]);
    expect(sortSessions(list, "created").map((s) => s.key)).toEqual(["a", "b", "c", "d"]);
    expect(sortSessions(list, "name").map((s) => s.key)).toEqual(["b", "a", "d", "c"]);
  });

  it("groups by project: newest group first, the unknown folder last, same folder across slashes and case", () => {
    const g = groupSessions([...list, S({ key: "e", root: "c:/CODE/app/", at: 1 })], "project", "recent");
    expect(g.map((x) => x.label)).toEqual(["web", "app", "Không rõ thư mục"]);
    expect(g[1].sessions.map((s) => s.key)).toEqual(["b", "a", "e"]);
  });

  it("manual: activity never moves a row; new sessions on top, then the saved order", () => {
    const order = { sessions: ["b", "a", "e"], groups: ["c:/code/web", "c:/code/app"] };
    const g = groupSessions([...list, S({ key: "e", at: 1 }), S({ key: "f", created: 50 }), S({ key: "h", created: 900 })], "project", "manual", order);
    expect(g.map((x) => x.label)).toEqual(["web", "app", "Không rõ thư mục"]);
    expect(g[1].sessions.map((s) => s.key)).toEqual(["h", "f", "b", "a", "e"]);
    // Same sessions, every one just did a turn: nothing moves.
    const busy = [...list, S({ key: "e" }), S({ key: "f", created: 50 }), S({ key: "h", created: 900 })].map((s) => ({ ...s, at: 99_999 - s.key.charCodeAt(0) }));
    expect(groupSessions(busy, "project", "manual", order)[1].sessions.map((s) => s.key)).toEqual(["h", "f", "b", "a", "e"]);
    // Projects not placed yet go by name, above the placed ones.
    expect(groupSessions(list, "project", "manual").map((x) => x.label)).toEqual(["app", "web", "Không rõ thư mục"]);
  });

  it("moveKey: the dragged key takes the target's place, the shown list becomes the order", () => {
    expect(moveKey([], ["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveKey([], ["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveKey(["x", "b", "a"], ["a", "b"], "a", "a")).toEqual(["a", "b", "x"]);
    expect(moveKey(["x"], ["a", "b"], "z", "a")).toEqual(["x"]);
  });

  it("groups by project in name order when sorting by name", () => {
    expect(groupSessions(list, "project", "name").map((x) => x.label)).toEqual(["app", "web", "Không rõ thư mục"]);
  });

  it("groups by state in attention order, skipping empty states", () => {
    expect(groupSessions(list, "state", "recent").map((x) => x.label)).toEqual(["Chờ anh", "Đang làm", "Nghỉ"]);
  });

  it("has one group without grouping, none for an empty list", () => {
    expect(groupSessions(list, "none", "name")[0].sessions.map((s) => s.key)).toEqual(["b", "a", "d", "c"]);
    expect(groupSessions([], "none", "recent")).toEqual([]);
  });
});

describe("splitChildren", () => {
  const c = (key: string, state: TreeChild["state"], at: number | null): TreeChild => ({ key, title: key, state, at, detail: null });
  it("shows running and recent sub-sessions, the rest as older", () => {
    const now = 10_000_000;
    const r = splitChildren([c("old", "done", now - 3_600_000), c("run", "working", now - 3_600_000), c("new", "done", now - 60_000), c("never", "idle", null)], now);
    expect(r.shown.map((x) => x.key)).toEqual(["new", "run"]);
    expect(r.older.map((x) => x.key)).toEqual(["never", "old"]);
  });

  it("keeps siblings in place when one starts working or turns active", () => {
    const now = 10_000_000;
    const before = splitChildren([c("b", "done", now - 60_000), c("a", "done", now - 120_000), c("c", "idle", now - 90_000)], now);
    const after = splitChildren([c("b", "done", now - 60_000), c("a", "done", now - 120_000), c("c", "working", now)], now);
    expect(before.shown.map((x) => x.key)).toEqual(["a", "b", "c"]);
    expect(after.shown.map((x) => x.key)).toEqual(["a", "b", "c"]);
  });
});

describe("attention and keyboard", () => {
  it("marks sessions that stopped working since the last poll", () => {
    expect(finishedSince({ a: "working", b: "working", c: "idle" }, [S({ key: "a", state: "done" }), S({ key: "b", state: "working" }), S({ key: "c", state: "done" }), S({ key: "d", state: "idle" })])).toEqual(["a"]);
  });

  it("dots what waits on the owner, or finished unseen", () => {
    expect(isUnread(S({ key: "a", state: "needs" }), [])).toBe(true);
    expect(isUnread(S({ key: "a", state: "done" }), ["a"])).toBe(true);
    expect(isUnread(S({ key: "a", state: "working" }), ["a"])).toBe(false);
    expect(isUnread(S({ key: "a", state: "idle" }), [])).toBe(false);
  });

  it("cycles keys both ways, wrapping", () => {
    expect(cycleKey(["a", "b", "c"], "c", 1)).toBe("a");
    expect(cycleKey(["a", "b", "c"], "a", -1)).toBe("c");
    expect(cycleKey(["a", "b"], null, 1)).toBe("a");
    expect(cycleKey(["a", "b"], "zz", -1)).toBe("b");
    expect(cycleKey([], "a", 1)).toBeNull();
  });

  it("buckets sessions by state for Tổng quan", () => {
    const b = byState([S({ key: "a", state: "error" }), S({ key: "b", state: "needs", at: 1 }), S({ key: "c", state: "needs", at: 2 })]);
    expect(b.needs.map((s) => s.key)).toEqual(["c", "b"]);
    expect(b.error.map((s) => s.key)).toEqual(["a"]);
    expect(b.working).toEqual([]);
  });
});

describe("local prefs and archive", () => {
  it("keeps only well-formed prefs", () => {
    expect(readPrefs(JSON.stringify({ group: "state", sort: "name", collapsed: ["x", 3, ""] }))).toEqual({ group: "state", sort: "name", collapsed: ["x"] });
    expect(readPrefs(JSON.stringify({ group: "bogus", sort: 1 }))).toEqual({ group: "project", sort: "manual", collapsed: [] });
    expect(readPrefs("{not json")).toEqual({ group: "project", sort: "manual", collapsed: [] });
    expect(readPrefs(null)).toEqual({ group: "project", sort: "manual", collapsed: [] });
  });

  it("moves browsers that only saved the old default to manual, keeps a recent the owner picked", () => {
    expect(readPrefs(JSON.stringify({ group: "project", sort: "recent", collapsed: [] })).sort).toBe("manual");
    expect(readPrefs(JSON.stringify({ group: "project", sort: "recent", collapsed: [], v: 2 })).sort).toBe("recent");
    expect(readOrder(JSON.stringify({ sessions: ["a", 2], groups: "x" }))).toEqual({ sessions: ["a"], groups: [] });
  });

  it("reads the archive list and toggles keys", () => {
    expect(readArchive(JSON.stringify(["a", 1, "b"]))).toEqual(["a", "b"]);
    expect(readArchive("{}")).toEqual([]);
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sessionNameFrom", () => {
  it("makes a safe, unique omp name from a Vietnamese prompt", () => {
    expect(sessionNameFrom("Sửa lỗi đăng nhập trên trang chủ nhé", [])).toBe("sua-loi-dang-nhap-tren");
    expect(sessionNameFrom("Sửa lỗi", ["sua-loi", "sua-loi-2"])).toBe("sua-loi-3");
    expect(sessionNameFrom("!!!", [])).toBe("phien");
    expect(sessionNameFrom("ls", [])).toBe("phien-ls");
    expect(sessionNameFrom("a".repeat(80), []).length).toBeLessThanOrEqual(32);
  });
});

describe("replacePane", () => {
  const p = (id: string) => ({ id, name: id, cwd: "C:\\x" });
  it("takes the active pane's place, keeps the others, and opens the first pane", () => {
    const s: WorkspaceState = { panes: [p("a"), p("b")], active: "b", max: null };
    expect(replacePane(s, p("c"))).toEqual({ panes: [p("a"), p("c")], active: "c", max: null });
    expect(replacePane(s, p("a"))).toMatchObject({ panes: [p("a"), p("b")], active: "a" });
    expect(replacePane({ panes: [], active: null, max: null }, p("a"))).toEqual({ panes: [p("a")], active: "a", max: null });
  });
});

describe("omp sub-sessions on disk", () => {
  it("reads task subagents next to the transcript: result → Xong, empty → Lỗi, fresh → Đang làm, else Nghỉ", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-tree-"));
    try {
      const transcript = path.join(dir, "2026-11-02T00-00-00-000Z_abc.jsonl");
      fs.writeFileSync(transcript, "{}\n");
      const sub = transcript.replace(/\.jsonl$/, "");
      fs.mkdirSync(sub);
      const now = Date.now();
      const put = (name: string, ageMs: number, md?: string) => {
        fs.writeFileSync(path.join(sub, `${name}.jsonl`), "{}\n");
        const t = new Date(now - ageMs);
        fs.utimesSync(path.join(sub, `${name}.jsonl`), t, t);
        if (md !== undefined) fs.writeFileSync(path.join(sub, `${name}.md`), md);
      };
      put("Done", 10 * 60_000, "## Kết quả\n\nĐã sửa xong");
      put("Failed", 20 * 60_000, "");
      put("Running", 5_000);
      put("Stopped", 30 * 60_000);
      fs.writeFileSync(path.join(sub, "Running.log"), "x");
      const kids = ompChildren(transcript, "omp-1", now);
      expect(kids.map((k) => [k.title, k.state])).toEqual([
        ["Running", "working"],
        ["Done", "done"],
        ["Failed", "error"],
        ["Stopped", "idle"],
      ]);
      expect(kids[1]).toMatchObject({ key: "omp-1/Done", detail: "Kết quả" });
      expect(kids[2].detail).toBe("Kết thúc mà không có kết quả");
      expect(ompChildren(path.join(dir, "missing.jsonl"), "omp-1", now)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads creation times from the 8sync registry", () => {
    const reg = fs.mkdtempSync(path.join(os.tmpdir(), "hq-reg-"));
    try {
      fs.mkdirSync(path.join(reg, "C--code-app"));
      fs.writeFileSync(path.join(reg, "C--code-app", "index.json"), JSON.stringify({ root: "C:\\code\\app", sessions: [{ name: "fix", created: 1700 }, { name: 3 }] }));
      fs.mkdirSync(path.join(reg, "broken"));
      fs.writeFileSync(path.join(reg, "broken", "index.json"), "{");
      const m = registryCreated(reg);
      expect([...m]).toEqual([["c:/code/app\0fix", 1_700_000]]);
    } finally {
      fs.rmSync(reg, { recursive: true, force: true });
    }
  });
});
