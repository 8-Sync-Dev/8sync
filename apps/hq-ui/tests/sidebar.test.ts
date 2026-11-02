import { describe, expect, it } from "vitest";
import { repoOf, groupKey, sidebarGroups, splitClosed } from "@/lib/sidebar";
import type { Room } from "@/lib/server/office";
import { mergeSessions, type OmpTreeRow, type TreeChild } from "@/lib/session-tree";
import type { SessionTree } from "@/components/hq/use-session-tree";

const NOW = Date.parse("2026-10-17T16:00:00Z");

function room(over: Partial<Room> & { name: string; root?: string }): Room {
  const root = over.root ?? "C:\\code\\ai-game-studio";
  return {
    key: over.name,
    session_id: null,
    label: over.name,
    status: "idle",
    waiting: null,
    ask: null,
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
    seats: [],
    role: null,
    engine: "ccc",
    ...over,
  };
}

describe("repoOf", () => {
  it("folds a Claude Code worktree under its repo (Windows and POSIX paths)", () => {
    expect(repoOf("C:\\code\\ai-game-studio\\.claude\\worktrees\\card-12")).toEqual({ root: "C:\\code\\ai-game-studio", name: "ai-game-studio", worktree: "card-12" });
    expect(repoOf("/home/a/su-code/.claude/worktrees/handoff-utf8/")).toEqual({ root: "/home/a/su-code", name: "su-code", worktree: "handoff-utf8" });
  });
  it("keeps any other folder as its own repo", () => {
    expect(repoOf("/home/a/8sync-startup")).toEqual({ root: "/home/a/8sync-startup", name: "8sync-startup", worktree: null });
    // A nested folder under worktrees is not a worktree root.
    expect(repoOf("/r/.claude/worktrees/x/sub").worktree).toBeNull();
  });
});

describe("sidebarGroups", () => {
  it("puts worktree rooms under their repo, after the repo's own rooms, and drops ended rooms", () => {
    const g = sidebarGroups(
      [
        room({ name: "dev", root: "C:\\code\\ai-game-studio\\.claude\\worktrees\\card-12", status: "running" }),
        room({ name: "lead", status: "running" }),
        room({ name: "qa" }),
        room({ name: "old", status: "ended" }),
      ],
      NOW,
    );
    expect(g).toHaveLength(1);
    expect(g[0].name).toBe("ai-game-studio");
    expect(g[0].rooms.map((x) => [x.room.name, x.worktree, x.now.state])).toEqual([
      ["lead", null, "working"],
      ["qa", null, "idle"],
      ["dev", "card-12", "working"],
    ]);
  });

  it("lists a repo with a room waiting on the owner first and counts it", () => {
    const g = sidebarGroups(
      [
        room({ name: "core", root: "/w/8sync-startup", status: "running" }),
        room({ name: "reels", root: "/w/content-post-agency" }),
        room({ name: "dev", root: "/w/zz-game", status: "needs_input", waiting: "input needed" }),
      ],
      NOW,
    );
    expect(g.map((x) => [x.name, x.needs])).toEqual([
      ["zz-game", 1],
      ["8sync-startup", 0],
      ["content-post-agency", 0],
    ]);
    expect(g[0].rooms[0].now.state).toBe("needs");
  });

  it("groups a room without a git root by its cwd, and one with neither last", () => {
    const g = sidebarGroups([room({ name: "vps", project: null, cwd: "/srv/vps" }), room({ name: "x", project: null, cwd: null }), room({ name: "a", root: "/w/b" })], NOW);
    expect(g.map((x) => x.name)).toEqual(["b", "vps", "Không rõ thư mục"]);
  });
});

describe("splitClosed", () => {
  const groups = (rooms: Room[]) => sidebarGroups(rooms, NOW);
  const hide = (root: string, at: number) => ({ key: groupKey(root), root, name: root.split("/").pop()!, hidden_at: at });

  it("hides a closed project until something happens in it", () => {
    const g = groups([room({ name: "dev", root: "/w/card-113-dev", last_active: NOW - 60_000 }), room({ name: "core", root: "/w/8sync-startup" })]);
    const r = splitClosed(g, [hide("/w/card-113-dev", NOW - 30_000)]);
    expect(r.shown.map((x) => x.name)).toEqual(["8sync-startup"]);
    expect(r.closed.map((x) => x.name)).toEqual(["card-113-dev"]);
  });

  it("brings it back on new activity after the close, and matches the key across slash style and case", () => {
    const g = groups([room({ name: "dev", root: "C:\\W\\card-113-dev", last_active: NOW - 10_000 })]);
    const r = splitClosed(g, [{ ...hide("/w/x", NOW - 30_000), key: "c:/w/card-113-dev" }]);
    expect(r.closed).toEqual([]);
    expect(r.shown).toHaveLength(1);
  });

  it("brings it back while a room waits on the owner, even with no newer transcript", () => {
    const g = groups([room({ name: "dev", root: "/w/game", status: "needs_input", waiting: "input needed", last_active: NOW - 3_600_000 })]);
    expect(splitClosed(g, [hide("/w/game", NOW)]).shown).toHaveLength(1);
  });

  it("keeps it closed when activity is unknown, and shows everything with no closed project", () => {
    const g = groups([room({ name: "dev", root: "/w/game", last_active: null })]);
    expect(splitClosed(g, [hide("/w/game", NOW - 1)]).closed).toHaveLength(1);
    expect(splitClosed(g, []).shown).toHaveLength(1);
  });
});

describe("sidebar UI", () => {
  const hq = {
    live: "live",
    projects: { data: [{ id: 7, path: "/w/new-repo", name: "new-repo", added_at: 0 }, { id: 8, path: "/w/8sync-startup", name: "8sync-startup", added_at: 0 }], loading: false, error: null },
    api: async () => ({}),
    reload: { projects: async () => {}, sessions: async () => {} },
  };
  const office = (rooms: Room[] | null, error: string | null = null, hidden: unknown[] = []) => ({ office: rooms ? { at: NOW, rooms, hidden } : null, error, retry: () => {} });
  const kid = (agent: string, state: TreeChild["state"], ago: number): TreeChild => ({ key: `omp-00000000000000aa/${agent}`, title: agent, state, at: NOW - ago, detail: null });
  const ompRow = (over: Partial<OmpTreeRow> = {}): OmpTreeRow => ({ id: "omp-00000000000000aa", name: "fix-login", title: "Sửa đăng nhập", cwd: "/w/8sync-startup", state: "working", doing: null, last_active: NOW - 5_000, created: NOW - 60_000, children: [], ...over });

  async function nav(o: ReturnType<typeof office>, omp: OmpTreeRow[] = [], active: string | null = null, tree?: Partial<SessionTree>) {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Nav } = await import("@/components/hq/nav");
    const t: SessionTree = { sessions: mergeSessions(o.office?.rooms ?? [], omp), at: NOW, loading: false, error: null, reload: () => {}, ...tree };
    const noop = () => {};
    const props = { hq, office: o, tree: t, tab: "workspace", active, onTab: noop, onNew: noop, onOpenSession: noop, onOpenRoom: noop, onOpenRepo: noop, onOpenFolder: noop, onAddProject: noop, onHelp: noop };
    return renderToStaticMarkup(createElement(Nav, props as unknown as Parameters<typeof Nav>[0]));
  }

  it("groups sessions by project with plain titles and state words; a worktree folds under its repo", async () => {
    const html = await nav(
      office([
        room({ name: "core", root: "/w/8sync-startup", status: "running" }),
        room({ name: "dev", root: "/w/8sync-startup/.claude/worktrees/card-12", status: "needs_input", waiting: "input needed" }),
      ]),
      [],
      "core",
    );
    for (const s of ["Phiên mới", "Tổng quan", "Văn phòng", "Vòng lặp", ">8sync-startup<", ">core<", ">dev<", "Đang làm", "Chờ anh", "worktree card-12", "Alex · 8 Sync", "Cài đặt máy"]) expect(html).toContain(s);
    expect(html).toContain('aria-current="true"');
    // A folder added in HQ with no session yet: its heading with "+" to start one there.
    expect(html).toContain("Phiên mới trong new-repo");
    expect(html.match(/>8sync-startup</g)).toHaveLength(1);
  });

  it("nests an omp session's sub-sessions on └ lines: running and recent shown, older behind +N cũ hơn", async () => {
    const html = await nav(office([]), [ompRow({ children: [kid("Scout", "working", 10_000), kid("Fixer", "done", 60_000), kid("Old", "done", 3 * 3_600_000)] })]);
    for (const s of ["Sửa đăng nhập", "Phiên con của Sửa đăng nhập", ">Scout<", ">Fixer<", "+1 cũ hơn", "Thu gọn 3 phiên con"]) expect(html).toContain(s);
    expect(html).not.toContain(">Old<");
  });

  it("has loading, empty and error states", async () => {
    expect(await nav(office(null), [], null, { loading: true })).toContain('aria-busy="true"');
    // No session yet: the added folders stand as empty groups, each with its "+".
    const empty = await nav(office([]));
    expect(empty).toContain("Phiên mới trong new-repo");
    expect(empty).not.toContain("Thao tác với phiên");
    const err = await nav(office(null, "HTTP 500"), [], null, { error: "HTTP 500" });
    expect(err).toContain("HTTP 500");
    expect(err).toContain('role="alert"');
  });

  it("puts Nhóm & sắp xếp on every heading and a ⋯ menu on every session; a hidden project waits in Đã lưu trữ", async () => {
    const rooms = [room({ name: "core", root: "/w/8sync-startup", status: "running" }), room({ name: "dev", root: "/w/game", last_active: NOW - 3_600_000 })];
    const open = await nav(office(rooms));
    for (const s of ["Nhóm &amp; sắp xếp: danh sách phiên", "Nhóm &amp; sắp xếp: 8sync-startup", "Nhóm &amp; sắp xếp: game", "Thao tác với phiên core", "Thao tác với phiên dev"]) expect(open).toContain(s);
    expect(open).not.toContain("Đã lưu trữ");

    const closed = await nav(office(rooms, null, [{ key: groupKey("/w/game"), root: "/w/game", name: "game", hidden_at: NOW - 60_000 }]));
    expect(closed).not.toContain("Thao tác với phiên dev");
    expect(closed).toContain("Thao tác với phiên core");
    expect(closed).toContain("Đã lưu trữ");
  });

  it("room brief: doing line, terminal button; the ask panel replaces it while the room waits", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { RoomBar, RoomBrief } = await import("@/components/hq/room-brief");
    const { roomNow } = await import("@/lib/now");
    const r = room({ name: "dev", session_id: "04d7c8d5-7473-44e7-bab9-0606b4db5a01", status: "running", doing: "Sửa nav.tsx", last_active: NOW - 120_000 });
    const n = roomNow(r, NOW);
    const html = renderToStaticMarkup(createElement(RoomBrief, { room: r, n, now: NOW, token: "t", onTerminal: () => {} }));
    for (const s of ["Đang làm", "Sửa nav.tsx", "2 phút trước"]) expect(html).toContain(s);
    // The title row and terminal button live in the pinned bar (owner 2026-10-20: lost once the log scrolled).
    const bar = renderToStaticMarkup(createElement(RoomBar, { room: r, n, token: "t", onTerminal: () => {} }));
    for (const s of ["dev", "Đang làm", "Mở terminal"]) expect(bar).toContain(s);
    expect(html).not.toContain("Mở terminal");
    expect(html).not.toContain("Anh cần trả lời");

    const w = room({ name: "lead", status: "needs_input", waiting: "input needed", delivery: "terminal" });
    const asking = renderToStaticMarkup(createElement(RoomBrief, { room: w, n: roomNow(w, NOW), now: NOW, token: "t", onTerminal: () => {} }));
    expect(asking).toContain("Anh cần trả lời");
    const askingBar = renderToStaticMarkup(createElement(RoomBar, { room: w, n: roomNow(w, NOW), token: "t", onTerminal: () => {} }));
    expect(askingBar).not.toContain("Mở terminal");
  });
});
