import { describe, expect, it } from "vitest";
import {
  botColors,
  botList,
  botMessages,
  botNames,
  botPreview,
  botStatus,
  botSummary,
  filterBots,
  hashId,
  promptSender,
  recentFiles,
  stepKey,
  stepsByTurn,
  threadItems,
  type BotMessage,
  type BotRoom,
} from "@/lib/bots";
import { turnsFrom } from "@/lib/room-turns";
import type { ActivityEvent } from "@/lib/server/activity";

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
const msg = (id: number, ts: number, o: Partial<BotMessage>): BotMessage => ({ id, ts, session: null, kind: "owner_message", from_: "owner", to_: null, text: null, ...o });

describe("bot status", () => {
  it("maps a room to Chờ anh / Lỗi / Đang làm / Rảnh", () => {
    expect(botStatus({ status: "needs_input", waiting: null, state: null })).toBe("needs");
    expect(botStatus({ status: "running", waiting: "Trust this folder?", state: "typing" })).toBe("needs");
    expect(botStatus({ status: "running", waiting: null, state: "stalled" })).toBe("error");
    expect(botStatus({ status: "running", waiting: null, state: "typing" })).toBe("working");
    expect(botStatus({ status: "idle", waiting: null, state: "done" })).toBe("idle");
  });
});

describe("bot avatar colour", () => {
  it("is stable per id and spreads ids over the hue wheel", () => {
    expect(hashId("omp-e127ac746f5322d4")).toBe(hashId("omp-e127ac746f5322d4"));
    expect(botColors("a").hue).toBe(botColors("a").hue);
    const hues = new Set(["omp-1", "omp-2", "omp-3", "omp-4", "omp-5", "omp-6"].map((k) => botColors(k).hue));
    expect(hues.size).toBeGreaterThan(4);
    const c = botColors("core");
    expect(c.hue).toBeGreaterThanOrEqual(0);
    expect(c.hue).toBeLessThan(360);
    expect(c.face).toBe(`oklch(0.86 0.08 ${c.hue})`);
  });
});

describe("bot names", () => {
  it("adds the project only where a label repeats, and a short id when even that repeats", () => {
    const names = botNames([
      room({ key: "omp-aaaa1", label: "core", project: { root: "C:/su-code", name: "su-code", branch: "main" } }),
      room({ key: "omp-bbbb2", label: "core", project: { root: "C:/okx", name: "okx", branch: "main" } }),
      room({ key: "omp-cccc3", label: "core", project: { root: "C:/okx", name: "okx", branch: "dev" } }),
      room({ key: "omp-dddd4", label: "learn", cwd: "C:\\Users\\tia" }),
    ]);
    expect(names.get("omp-aaaa1")).toEqual({ name: "core", qualifier: "su-code" });
    expect(names.get("omp-bbbb2")).toEqual({ name: "core", qualifier: "okx #bbbb" });
    expect(names.get("omp-cccc3")).toEqual({ name: "core", qualifier: "okx #cccc" });
    expect(names.get("omp-dddd4")).toEqual({ name: "learn", qualifier: null });
  });
});

describe("bot preview and order", () => {
  it("shows what a waiting bot asks, what a working bot does, else the newest line", () => {
    const ask = { kind: "question" as const, questions: [{ header: null, question: "Merge **PR #12**?", options: [], multi: false }], at: 1 };
    expect(botPreview({ ...room({ key: "a", status: "needs_input", ask }) }, []).text).toBe("Merge PR #12?");
    expect(botPreview(room({ key: "a", status: "needs_input", ask: { kind: "permission", tool: "Bash", what: null, at: 1 } }), []).text).toBe("Xin quyền Bash");
    expect(botPreview(room({ key: "a", status: "running", doing: "bash: Running   tests", last_active: 5 }), [msg(1, 9, { text: "hi" })])).toEqual({ text: "bash: Running tests", at: 5 });
    // Idle: the owner's newer message wins over an old `8sync ls` line, framed and with its files dropped.
    const sent = msg(1, 10, { text: `[owner → core]\nship it\n\nFile đính kèm (mở bằng Read trước khi làm):\n- C:/Users/me/.claude/hq-uploads/${"a".repeat(32)}/shot.png` });
    expect(botPreview(room({ key: "a", doing: "Đang chờ prompt mới", last_active: 5 }), [sent])).toEqual({ text: "Anh: ship it", at: 10 });
    expect(botPreview(room({ key: "a" }), []).text).toBe("Chưa có hoạt động nào");
  });

  it("orders Chờ anh, Lỗi, Đang làm, Rảnh, newest first inside each, and drops ended rooms", () => {
    const list = botList(
      [
        room({ key: "idle-old", last_active: 1 }),
        room({ key: "work", status: "running", last_active: 2 }),
        room({ key: "idle-new", last_active: 9 }),
        room({ key: "gone", status: "ended" }),
        room({ key: "ask", status: "needs_input" }),
        room({ key: "stuck", status: "running", state: "stalled" }),
      ],
      [],
      [],
    );
    expect(list.map((b) => b.key)).toEqual(["ask", "stuck", "work", "idle-new", "idle-old"]);
    expect(botSummary(list)).toBe("1 chờ anh · 1 lỗi · 1 đang làm · 2 rảnh");
  });

  it("ties messages to a room by any of its names", () => {
    const r = room({ key: "k", name: "hq-core", session_id: "abc" });
    const ms = [msg(2, 2, { session: "abc" }), msg(1, 1, { to_: "hq-core" }), msg(3, 3, { session: "other" }), msg(4, 4, { from_: "core-sid" })];
    expect(botMessages(r, [{ name: "hq-core", session_id: "core-sid" }], ms).map((m) => m.id)).toEqual([1, 2, 4]);
  });
});

describe("bot search and keys", () => {
  const bots = [
    { name: "core", qualifier: "su-code", project: "su-code", branch: "main", preview: "Đang chờ", status: "needs" as const },
    { name: "learn", qualifier: null, project: "tia", branch: null, preview: "bash: deploy", status: "idle" as const },
  ];
  it("matches without accents, across name, project and status, and filters by status", () => {
    expect(filterBots(bots, "cho anh").map((b) => b.name)).toEqual(["core"]);
    expect(filterBots(bots, "TIA deploy").map((b) => b.name)).toEqual(["learn"]);
    expect(filterBots(bots, "", "idle").map((b) => b.name)).toEqual(["learn"]);
    expect(filterBots(bots, "  ")).toHaveLength(2);
  });
  it("steps ↑/↓ through the list, clamped at the ends", () => {
    expect(stepKey(["a", "b", "c"], null, 1)).toBe("a");
    expect(stepKey(["a", "b", "c"], null, -1)).toBe("c");
    expect(stepKey(["a", "b", "c"], "b", 1)).toBe("c");
    expect(stepKey(["a", "b", "c"], "c", 1)).toBe("c");
    expect(stepKey(["a", "b", "c"], "a", -1)).toBe("a");
    expect(stepKey([], "a", 1)).toBeNull();
  });
});

describe("bot thread", () => {
  const ev = (kind: ActivityEvent["kind"], at: number, text: string, more: Partial<ActivityEvent> = {}): ActivityEvent => ({ kind, at, text, ...more });

  it("reads who sent a prompt from HQ's frame", () => {
    expect(promptSender("[phòng web → core]\nlàm API")).toEqual({ kind: "room", name: "web" });
    expect(promptSender("[tự động]\nnhắc")).toEqual({ kind: "auto" });
    expect(promptSender("[owner → core]\nhi")).toEqual({ kind: "owner" });
    expect(promptSender("typed in the terminal")).toEqual({ kind: "owner" });
  });

  it("groups steps under the turn they ran in, keyed like turnsFrom", () => {
    const events = [ev("tool", 1, "warm-up"), ev("prompt", 10, "fix it"), ev("tool", 11, "a.ts", { tool: "Edit" }), ev("text", 12, "done"), ev("prompt", 20, "next"), ev("agent", 21, "scout")];
    const turns = turnsFrom(events);
    const steps = stepsByTurn(events);
    expect(turns.map((t) => (steps.get(t.key) ?? []).map((s) => s.text))).toEqual([["warm-up"], ["a.ts"], ["scout"]]);
  });

  it("folds the owner's message into the turn it started, keeps an unpicked one, drops a reply the turn already shows", () => {
    const events = [ev("prompt", 1_000_000, "[owner → core]\nfix the login bug"), ev("tool", 1_000_500, "src/login.ts", { tool: "Edit", status: "ok" }), ev("text", 1_001_000, "Fixed the login bug in src/login.ts.")];
    const turns = turnsFrom(events);
    const sent = msg(1, 999_000, { session: "core", to_: "core", text: "fix the login bug" });
    const queued = msg(2, 2_000_000, { session: "core", to_: "core", text: "and add a test" });
    const reply = msg(3, 1_001_500, { kind: "session_reply", from_: "core", text: "Fixed the login bug in src/login.ts." });
    const items = threadItems([sent, reply, queued], turns, events);
    expect(items.map((i) => i.kind)).toEqual(["turn", "message"]);
    const t = items[0];
    if (t.kind !== "turn") throw new Error("turn first");
    expect(t.sent?.id).toBe(1);
    expect(t.prompt).toBeNull();
    expect(t.steps.map((s) => s.text)).toEqual(["src/login.ts"]);
    expect(items[1].kind === "message" && items[1].m.id).toBe(2);
  });

  it("shows a prompt from another room with its sender when no HQ message stands for it", () => {
    const events = [ev("prompt", 5, "[phòng web → core]\nAPI cho trang login"), ev("text", 6, "ok")];
    const [t] = threadItems([], turnsFrom(events), events);
    expect(t.kind === "turn" && { prompt: t.prompt, from: t.from }).toEqual({ prompt: "API cho trang login", from: { kind: "room", name: "web" } });
  });

  it("lists the files a room wrote lately, newest first, once each", () => {
    const events = [
      ev("tool", 1, "apps/a.ts", { tool: "Edit", status: "ok" }),
      ev("tool", 2, "Running tests", { tool: "Bash", status: "ok" }),
      ev("tool", 3, "C:\\repo\\b.md", { tool: "write", status: "ok" }),
      ev("tool", 4, "apps/a.ts", { tool: "Edit", status: "ok" }),
      ev("tool", 5, "bad.ts", { tool: "Edit", status: "error" }),
      ev("tool", 6, "Fix the header", { tool: "Edit", status: "ok" }),
    ];
    expect(recentFiles(events)).toEqual(["apps/a.ts", "C:\\repo\\b.md"]);
  });
});
