import { describe, expect, it } from "vitest";
import { repoOf, sidebarGroups } from "@/lib/sidebar";
import type { Room } from "@/lib/server/office";

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
    meeting: null,
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
      [],
      NOW,
    );
    expect(g).toHaveLength(1);
    expect(g[0].name).toBe("ai-game-studio");
    expect(g[0].rooms.map((x) => [x.room.name, x.worktree, x.now.state])).toEqual([
      ["lead", null, "working"],
      ["qa", null, "waiting"],
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
      [],
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
    const g = sidebarGroups([room({ name: "vps", project: null, cwd: "/srv/vps" }), room({ name: "x", project: null, cwd: null }), room({ name: "a", root: "/w/b" })], [], NOW);
    expect(g.map((x) => x.name)).toEqual(["b", "vps", "Không rõ thư mục"]);
  });
});

describe("sidebar UI", () => {
  const hq = {
    live: "live",
    projects: { data: [{ id: 7, path: "/w/new-repo", name: "new-repo", added_at: 0 }, { id: 8, path: "/w/8sync-startup", name: "8sync-startup", added_at: 0 }], loading: false, error: null },
    api: async () => ({}),
    reload: { projects: async () => {}, sessions: async () => {} },
  };
  const office = (rooms: Room[] | null, error: string | null = null) => ({ office: rooms ? { at: NOW, rooms } : null, error, retry: () => {} });

  async function nav(o: ReturnType<typeof office>, session: string | null = null) {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Nav } = await import("@/components/hq/nav");
    const props = { hq, scope: { project: null, session }, office: o, boards: [], onHome: () => {}, onOpenRoom: () => {}, onOpenFolder: () => {} };
    return renderToStaticMarkup(createElement(Nav, props as unknown as Parameters<typeof Nav>[0]));
  }

  it("shows rooms with a state word and a Chờ anh badge, worktrees under their repo, no misleading empty copy", async () => {
    const html = await nav(
      office([
        room({ name: "core", root: "/w/8sync-startup", status: "running" }),
        room({ name: "dev", root: "/w/8sync-startup/.claude/worktrees/card-12", status: "needs_input", waiting: "input needed" }),
      ]),
      "core",
    );
    for (const s of ["8sync-startup", "core", "Đang làm", "Chờ anh", "card-12", "1<span class=\"sr-only\"> phòng chờ anh</span>", "Chưa có team", "new-repo", "Mở team ở repo mới"]) expect(html).toContain(s);
    expect(html).toContain('aria-current="true"');
    expect(html).not.toContain("No folders yet");
    // A registered folder that already has rooms is not listed again as roomless.
    expect(html.match(/>8sync-startup</g)).toHaveLength(1);
  });

  it("has loading, empty and error states", async () => {
    expect(await nav(office(null))).toContain('aria-busy="true"');
    expect(await nav(office([]))).toContain("Dự án có phòng đang chạy tự hiện ở đây");
    const err = await nav(office(null, "HTTP 500"));
    expect(err).toContain("HTTP 500");
    expect(err).toContain('role="alert"');
  });

  it("room brief: doing line, card, terminal button; the ask panel replaces it while the room waits", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { RoomBrief } = await import("@/components/hq/room-brief");
    const { roomNow } = await import("@/lib/now");
    const r = room({ name: "dev", session_id: "04d7c8d5-7473-44e7-bab9-0606b4db5a01", status: "running", doing: "Sửa nav.tsx", last_active: NOW - 120_000 });
    const card = { id: 12, text: "Sidebar mở phòng", lane: "building", check: null, label: null, claim: { room: "dev", at: NOW - 60_000 }, pr: null, sha: null, bounces: 0, note: null, added: 0 };
    const empty = { backlog: [], ready: [], building: [], qa: [], review: [], approved: [], blocked: [] };
    const boards = [{ root: "C:\\code\\ai-game-studio", board: { lanes: { ...empty, building: [card] }, closed: [] } }] as unknown as Parameters<typeof roomNow>[1];
    const html = renderToStaticMarkup(createElement(RoomBrief, { room: r, n: roomNow(r, boards, NOW), now: NOW, token: "t", onTerminal: () => {} }));
    for (const s of ["dev", "Đang làm", "Sửa nav.tsx", "2 phút trước", "#12", "Sidebar mở phòng", "Building", "Mở terminal"]) expect(html).toContain(s);
    expect(html).not.toContain("Anh cần trả lời");

    const w = room({ name: "lead", status: "needs_input", waiting: "input needed", delivery: "terminal" });
    const asking = renderToStaticMarkup(createElement(RoomBrief, { room: w, n: roomNow(w, [], NOW), now: NOW, token: "t", onTerminal: () => {} }));
    expect(asking).toContain("Anh cần trả lời");
    expect(asking).toContain("Không giữ card nào.");
  });
});
