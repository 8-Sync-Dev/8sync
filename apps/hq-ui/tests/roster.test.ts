import { describe, expect, it } from "vitest";
import { botList, type BotRoom } from "@/lib/bots";
import { botId, botRepo, botRole, isHelperRoom, primaryKey, rosterBots, rosterSections } from "@/lib/roster";

const room = (o: Partial<BotRoom> & { key: string }): BotRoom => ({
  name: o.key,
  session_id: o.key,
  label: o.key,
  status: "idle",
  waiting: null,
  ask: null,
  cwd: null,
  project: null,
  doing: null,
  state: null,
  last_active: null,
  ...o,
});
const at = (root: string, branch = "main") => ({ root, name: root.split(/[/\\]/).pop()!, branch });

describe("roster rows (owner 2026-11-07: the sidebar lists bots, not sessions)", () => {
  it("drops subagents and team workers; a worktree room folds under its repo", () => {
    expect(isHelperRoom("__advisor")).toBe(true);
    expect(isHelperRoom("worker-ui")).toBe(true);
    expect(isHelperRoom("Worker-shell")).toBe(true);
    expect(isHelperRoom("core")).toBe(false);
    expect(isHelperRoom("coworker-x")).toBe(false);
    expect(isHelperRoom("_draft")).toBe(false);
    const bots = rosterBots(
      botList(
        [
          room({ key: "omp-1", label: "core", project: at("C:/w/su-code") }),
          room({ key: "omp-2", label: "__advisor", project: at("C:/w/su-code") }),
          room({ key: "omp-3", label: "worker-ui", project: at("C:/w/su-code") }),
          room({ key: "omp-4", label: "fix", project: at("C:\\w\\su-code\\.claude\\worktrees\\card-12", "card-12") }),
          room({ key: "omp-5", label: "ended", status: "ended" }),
        ],
        [],
        [],
      ),
    );
    expect(bots.map((b) => b.key)).toEqual(["omp-1", "omp-4"]);
    expect(bots.find((b) => b.key === "omp-4")!.section).toBe("su-code");
    expect(bots.find((b) => b.key === "omp-4")!.root).toBe("C:\\w\\su-code");
  });

  it("keeps a bot's identity across a restart (new room key) and apart across repos", () => {
    const a = room({ key: "omp-aaa", label: "Core", project: at("C:/w/su-code") });
    expect(botId(a)).toBe(botId({ ...a, key: "omp-bbb" } as BotRoom));
    expect(botId(a)).toBe("core@c:/w/su-code");
    expect(botId(room({ key: "x", label: "core", project: at("C:/w/okx") }))).not.toBe(botId(a));
    expect(botId(room({ key: "y", label: "learn" }))).toBe("learn@");
    expect(botRepo(room({ key: "z", label: "z", cwd: "C:\\Users\\Admin" }))).toEqual({ root: "C:\\Users\\Admin", name: "Admin" });
    expect(botRepo(room({ key: "z", label: "z" }))).toBeNull();
  });

  it("names each bot's job: label words, then template, then HQ role, else Trợ lý", () => {
    expect(botRole("core")).toBe("Điều phối");
    expect(botRole("clean")).toBe("Dọn máy");
    expect(botRole("learn")).toBe("Học và ghi nhớ");
    expect(botRole("mkt")).toBe("Marketing");
    expect(botRole("game-studio")).toBe("Làm game");
    expect(botRole("coding")).toBe("Lập trình");
    expect(botRole("fullstack-shop")).not.toBe("Trợ lý");
    expect(botRole("alpha", "reviewer")).not.toBe("Trợ lý");
    expect(botRole("alpha")).toBe("Trợ lý");
    expect(botRole("corepack")).toBe("Trợ lý");
  });
});

describe("Primary Bot", () => {
  const b = (key: string, name: string, root: string | null, at: number) => ({ key, name, root, at });
  const bots = [b("c1", "core", "C:/w/okx", 300), b("c2", "core", "C:/w/su-code", 100), b("l", "learn", null, 900)];
  it("is the Chief of Staff while it runs", () => {
    expect(primaryKey(bots, "l", ["C:/w/su-code"])).toBe("l");
  });
  it("else the core room of the project whose /solo runs, matched across slash style and case", () => {
    expect(primaryKey(bots, null, ["c:\\W\\su-code\\"])).toBe("c2");
    expect(primaryKey(bots, "gone", ["C:/w/su-code"])).toBe("c2");
  });
  it("else the core room active last; none without a core", () => {
    expect(primaryKey(bots, null, [])).toBe("c1");
    expect(primaryKey(bots, null, ["C:/w/elsewhere"])).toBe("c1");
    expect(primaryKey([b("l", "learn", null, 1)], null, [])).toBeNull();
  });
});

describe("roster sections", () => {
  const r = (key: string, status: "needs" | "error" | "working" | "idle", section: string) => ({ key, id: `${key}@`, status, section });
  const bots = [r("ask", "needs", "tia"), r("core", "working", "su-code"), r("a", "working", "tia"), r("b", "idle", "okx"), r("c", "idle", "Khác"), r("d", "idle", "su-code"), r("e", "idle", "Ứng dụng")];

  it("puts Chờ anh first, then the Primary Bot, pins, projects A→Z (Khác last) and Bot ẩn", () => {
    const s = rosterSections(bots, { primary: "core", pins: ["d@", "a@"], hidden: ["b@"] });
    expect(s.map((x) => [x.id, x.bots.map((y) => y.key)])).toEqual([
      ["needs", ["ask"]],
      ["primary", ["core"]],
      ["pinned", ["d", "a"]],
      ["p:Ứng dụng", ["e"]],
      ["p:Khác", ["c"]],
      ["hidden", ["b"]],
    ]);
    expect(s[0].title).toBe("Chờ anh");
    expect(s.at(-1)!.title).toBe("Bot ẩn");
  });

  it("floats a waiting bot up even when hidden, pinned or primary; every bot shows once", () => {
    const s = rosterSections([r("p", "needs", "x"), r("h", "needs", "x"), r("k", "needs", "x"), r("z", "idle", "x")], { primary: "p", pins: ["k@"], hidden: ["h@"] });
    expect(s.map((x) => x.id)).toEqual(["needs", "p:x"]);
    expect(s[0].bots.map((x) => x.key)).toEqual(["p", "h", "k"]);
    const all = rosterSections(bots, { primary: null, pins: [], hidden: [] }).flatMap((x) => x.bots.map((y) => y.key));
    expect(all.sort()).toEqual(bots.map((x) => x.key).sort());
  });

  it("keeps the incoming order inside a project and leaves empty sections out", () => {
    const s = rosterSections([r("d", "idle", "su-code"), r("core", "working", "su-code")], { primary: null, pins: ["gone@"], hidden: [] });
    expect(s).toEqual([{ id: "p:su-code", title: "su-code", bots: [r("d", "idle", "su-code"), r("core", "working", "su-code")] }]);
    expect(rosterSections([], { primary: null, pins: [], hidden: [] })).toEqual([]);
  });
});
