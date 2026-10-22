import { describe, expect, it } from "vitest";
import { companyRooms, companySidebar, peopleWord, projectsHeading, repoOf, groupKey, sidebarGroups, splitClosed } from "@/lib/sidebar";
import { parseBoard, type Board } from "@/lib/lanes";
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
    engine: "ccc",
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

describe("splitClosed", () => {
  const groups = (rooms: Room[]) => sidebarGroups(rooms, [], NOW);
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

  it("labels omp rooms with their team", async () => {
    const html = await nav(office([room({ name: "omp-0123456789abcdef", label: "scout", engine: "omp", status: "running" }), room({ name: "core", status: "running" })]));
    expect(html).toContain("Đội omp");
    expect(html).toContain("scout · Đội omp");
    expect(html).toContain("core · Đội ccc");
  });

  it("has loading, empty and error states", async () => {
    expect(await nav(office(null))).toContain('aria-busy="true"');
    expect(await nav(office([]))).toContain("Dự án có phòng đang chạy tự hiện ở đây");
    const err = await nav(office(null, "HTTP 500"));
    expect(err).toContain("HTTP 500");
    expect(err).toContain('role="alert"');
  });

  it("puts a ⋯ menu on every project and room row, and lists a closed project behind its toggle", async () => {
    const rooms = [
      room({ name: "core", root: "/w/8sync-startup", status: "running" }),
      room({ name: "dev", root: "/w/game/.claude/worktrees/card-113-dev/.claude/worktrees/card-147-fix", last_active: NOW - 3_600_000 }),
    ];
    const open = await nav(office(rooms));
    for (const s of ["Thao tác với dự án 8sync-startup", "Thao tác với phòng core", "Thao tác với dự án card-113-dev", "Thao tác với phòng dev", "card-147-fix"]) expect(open).toContain(s);
    expect(open).not.toContain("dự án đã đóng");

    const root = "/w/game/.claude/worktrees/card-113-dev";
    const closed = await nav(office(rooms, null, [{ key: groupKey(root), root, name: "card-113-dev", hidden_at: NOW - 60_000 }]));
    expect(closed).toContain("Hiện dự án đã đóng (1)");
    expect(closed).toContain("Hiện lại dự án card-113-dev");
    expect(closed).not.toContain("Thao tác với dự án card-113-dev");
    expect(closed).toContain("Thao tác với dự án 8sync-startup");
  });

  it("says so when every project is closed", async () => {
    const html = await nav(office([room({ name: "dev", root: "/w/game", last_active: NOW - 3_600_000 })], null, [{ key: "/w/game", root: "/w/game", name: "game", hidden_at: NOW }]));
    expect(html).toContain("Mọi dự án đang đóng");
    expect(html).toContain("Hiện dự án đã đóng (1)");
  });

  it("room brief: doing line, card, terminal button; the ask panel replaces it while the room waits", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { RoomBar, RoomBrief } = await import("@/components/hq/room-brief");
    const { roomNow } = await import("@/lib/now");
    const r = room({ name: "dev", session_id: "04d7c8d5-7473-44e7-bab9-0606b4db5a01", status: "running", doing: "Sửa nav.tsx", last_active: NOW - 120_000 });
    const card = { id: 12, text: "Sidebar mở phòng", lane: "building", check: null, label: null, claim: { room: "dev", at: NOW - 60_000 }, pr: null, sha: null, bounces: 0, note: null, added: 0 };
    const empty = { backlog: [], ready: [], building: [], qa: [], review: [], approved: [], blocked: [] };
    const boards = [{ root: "C:\\code\\ai-game-studio", board: { lanes: { ...empty, building: [card] }, closed: [] } }] as unknown as Parameters<typeof roomNow>[1];
    const n = roomNow(r, boards, NOW);
    const html = renderToStaticMarkup(createElement(RoomBrief, { room: r, n, now: NOW, token: "t", onTerminal: () => {} }));
    for (const s of ["Đang làm", "Sửa nav.tsx", "2 phút trước", "#12", "Sidebar mở phòng", "Building"]) expect(html).toContain(s);
    // The title row and terminal button live in the pinned bar (owner 2026-10-20: lost once the log scrolled).
    const bar = renderToStaticMarkup(createElement(RoomBar, { room: r, n, token: "t", onTerminal: () => {} }));
    for (const s of ["dev", "Đang làm", "Mở terminal"]) expect(bar).toContain(s);
    expect(html).not.toContain("Mở terminal");
    expect(html).not.toContain("Anh cần trả lời");

    const w = room({ name: "lead", status: "needs_input", waiting: "input needed", delivery: "terminal" });
    const asking = renderToStaticMarkup(createElement(RoomBrief, { room: w, n: roomNow(w, [], NOW), now: NOW, token: "t", onTerminal: () => {} }));
    expect(asking).toContain("Anh cần trả lời");
    const askingBar = renderToStaticMarkup(createElement(RoomBar, { room: w, n: roomNow(w, [], NOW), token: "t", onTerminal: () => {} }));
    expect(askingBar).not.toContain("Mở terminal");
    expect(asking).toContain("Không giữ card nào.");
  });
});

describe("projectsHeading", () => {
  it("says Công ty with the project count only in company mode", () => {
    expect(projectsHeading(false, 3)).toEqual({ title: "Dự án", hint: null });
    const h = projectsHeading(true, 2);
    expect(h.title).toBe("Công ty · 2 dự án");
    expect(h.hint).toContain("auto company");
  });
});

describe("company sidebar: one team, many projects", () => {
  const S = NOW / 1000;
  const board = (lanes: Record<string, unknown[]>): Board => parseBoard({ schema: 1, lanes: Object.entries(lanes).map(([lane, cards]) => ({ lane, cards })), closed: [] })!;
  const PLATFORM = "C:\\code\\platform";
  const IDE = "C:\\code\\ide";
  const boards = [
    { root: PLATFORM, board: board({ ready: [{ id: 1, text: "a" }, { id: 2, text: "b" }], building: [{ id: 3, text: "c", claim: { room: "dev", at: S - 60 } }] }) },
    { root: IDE, board: board({ building: [{ id: 9, text: "z", claim: { room: "dev2", at: S - 30 } }] }) },
  ];
  it("lists every room once, tagged with the project of the card it holds, and counts people per project", () => {
    const rooms = [room({ name: "dev", root: PLATFORM, status: "running" }), room({ name: "dev2", root: PLATFORM, status: "running" }), room({ name: "qa", root: PLATFORM })];
    const c = companySidebar(rooms, boards, NOW);
    expect(c.rooms).toHaveLength(3);
    expect(Object.fromEntries(c.rooms.map((x) => [x.room.label, x.at.name]))).toEqual({ dev: "platform", dev2: "ide", qa: "platform" });
    // qa holds no card: free for any project, so it carries no project tag in the sidebar
    expect(Object.fromEntries(c.rooms.map((x) => [x.room.label, x.working]))).toEqual({ dev: true, dev2: true, qa: false });
    // dev2 lives in platform but works on ide's card: it holds that card.
    expect(c.rooms.find((x) => x.room.label === "dev2")!.now.card?.id).toBe(9);
    const by = Object.fromEntries(c.projects.map((p) => [p.name, [p.people, p.open]]));
    expect(by).toEqual({ platform: [1, 3], ide: [1, 1] });
  });
  it("a project with a board and nobody on it still shows, with nobody", () => {
    const c = companySidebar([room({ name: "dev", root: PLATFORM, status: "running" })], boards, NOW);
    expect(c.projects.find((p) => p.name === "ide")).toMatchObject({ people: 0, open: 1 });
    expect(peopleWord(0)).toBe("chưa ai");
    expect(peopleWord(1)).toBe("1 người");
  });
  it("Văn phòng / Tổng quan: a room working on another project's card moves to that project; the rest stay home", () => {
    const rooms = [room({ name: "dev", root: PLATFORM }), room({ name: "dev2", root: PLATFORM }), room({ name: "qa", root: PLATFORM })];
    const moved = companyRooms(rooms, boards);
    expect(moved.map((r) => r.project?.name)).toEqual(["platform", "ide", "platform"]);
    expect(moved[1].cwd).toBe(IDE);
    // untouched rooms are the same objects
    expect(moved[0]).toBe(rooms[0]);
    expect(moved[2]).toBe(rooms[2]);
  });
});

describe("company sidebar UI (rendered)", () => {
  const S = NOW / 1000;
  const PLATFORM = "/w/platform";
  const IDE = "/w/ide";
  const board = (lanes: Record<string, unknown[]>): Board => parseBoard({ schema: 1, lanes: Object.entries(lanes).map(([lane, cards]) => ({ lane, cards })), closed: [] })!;
  const boards = [
    { root: PLATFORM, board: board({ ready: [{ id: 1, text: "a" }], building: [{ id: 3, text: "c", claim: { room: "dev", at: S - 60 } }] }) },
    { root: IDE, board: board({ building: [{ id: 9, text: "z", claim: { room: "dev2", at: S - 30 } }] }) },
    { root: "/w/news", board: board({ ready: [{ id: 4, text: "n" }] }) },
  ];
  const hq = { live: "live", projects: { data: [], loading: false, error: null }, api: async () => ({}), reload: { projects: async () => {}, sessions: async () => {} } };

  async function render(company: boolean) {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { Nav } = await import("@/components/hq/nav");
    const rooms = [room({ name: "dev", root: PLATFORM, status: "running" }), room({ name: "dev2", root: PLATFORM, status: "running" }), room({ name: "qa", root: PLATFORM })];
    const office = { office: { at: NOW, rooms, hidden: [], company }, error: null, retry: () => {} };
    const props = { hq, scope: { project: null, session: null }, office, boards, onHome: () => {}, onOpenRoom: () => {}, onOpenFolder: () => {}, onOpenRepo: () => {}, repo: null };
    return renderToStaticMarkup(createElement(Nav, props as unknown as Parameters<typeof Nav>[0]));
  }

  it("company on: one room list tagged by project, projects with how many work there, add box for the company", async () => {
    const html = await render(true);
    for (const s of ["Phòng của công ty · 3", "Công ty · 3 dự án", "dev2 ở ide", "dev ở platform", "1 người", "chưa ai", "Thêm dự án cho công ty"]) expect(html).toContain(s);
    // no per-project room folders: no "Thao tác với dự án" menu, no "Mở team ở repo mới"
    expect(html).not.toContain("Thao tác với dự án");
    expect(html).not.toContain("Mở team ở repo mới");
    // a room with no card is free: no project tag
    expect(html).not.toContain("qa ở platform");
    // each room once
    expect(html.match(/Thao tác với phòng dev2/g)).toHaveLength(1);
  });

  it("company off: the sidebar stays per project", async () => {
    const html = await render(false);
    expect(html).toContain("Thao tác với dự án platform");
    expect(html).toContain("Mở team ở repo mới");
    expect(html).not.toContain("Phòng của công ty");
  });
});

