import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as messagesPOST } from "@/app/api/messages/route";
import { POST as tasksPOST } from "@/app/api/tasks/route";
import { addressOf } from "@/lib/labels";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { inboxFile, inboxLive, isSessionId, LIVE_MS, pendingInbox } from "@/lib/server/inbox";
import { applyMapped, mapEvent } from "@/lib/server/ingest";
import { loadMeetings, projectOf, readLoops, readTranscriptStats, readUsage, type Room } from "@/lib/server/office";
import { messagesAfter } from "@/lib/server/queries";
import { stateDir } from "@/lib/server/paths";
import {
  SEATS,
  cloneCount,
  costPerTask,
  fmtDuration,
  fmtTokens,
  fmtUsd,
  groupByProject,
  matchesSession,
  officeTotals,
  roomFor,
  seatOf,
  seatState,
  seatsFor,
  visitsFrom,
} from "@/lib/office";
import {
  DUST_MS,
  WALK_MS,
  WALKER_CARRY,
  WALKER_CLIPS,
  WALKER_CARRY_DUST,
  WALKER_CARRY_STAND,
  WALKER_DUST,
  WALKER_FRAMES,
  WALKER_H,
  WALKER_PALETTE,
  WALKER_STAND,
  WALKER_W,
  mirror,
} from "@/lib/sprite/walker";
import { ORIGIN, req, tempHome } from "./helpers";

const SID = "1eb79553-8369-4a90-b428-2dedb50e18db";
const SID2 = "77cb0a68-ba5e-424e-bf43-15de95ed35fb";
let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

describe("seats: the same template in every room", () => {
  it("maps kit and built-in agent types to seats", () => {
    expect(SEATS.map((s) => s.key)).toEqual(["lead", "rd", "plan", "dev", "review", "qa", "quick", "critic"]);
    expect([seatOf("explore"), seatOf("researcher"), seatOf("pm"), seatOf("task"), seatOf("reviewer"), seatOf("qa"), seatOf("quick-task")]).toEqual(
      ["rd", "rd", "plan", "dev", "review", "qa", "quick"],
    );
    expect(seatOf("8sync-kit:verifier")).toBe("review");
    expect([seatOf("critic"), seatOf("8sync-kit:critic"), seatOf("reviewer"), seatOf("verifier")]).toEqual(["critic", "critic", "review", "review"]);
    expect(SEATS.find((s) => s.key === "critic")).toMatchObject({ label: "Critic", hint: "critic — phê bình, chọn thay owner" });
    expect(seatOf("something-new")).toBe("dev");
    expect(seatOf(null)).toBe("dev");
  });
  it("running agents are active, recently finished ones recent, old ones gone", () => {
    const now = 1_000_000;
    const seats = seatsFor(
      [
        { agent_id: "a1", agent_type: "reviewer", started_at: now - 5000, ended_at: null },
        { agent_id: "a2", agent_type: "explore", started_at: now - 9000, ended_at: now - 60_000 },
        { agent_id: "a3", agent_type: "explore", started_at: now - 9_000_000, ended_at: now - 3_600_000 },
      ],
      true,
      now,
    );
    const by = Object.fromEntries(seats.map((s) => [s.key, s]));
    expect(by.lead.active).toEqual(["lead"]);
    expect(by.review.active).toEqual(["reviewer"]);
    expect([by.rd.active.length, by.rd.recent]).toEqual([0, 1]);
    expect(seatsFor([], false, now).every((s) => s.active.length === 0)).toBe(true);
  });
});

describe("walks between rooms", () => {
  const rooms = [
    { key: "hq-api", ids: ["hq-api", "api"] },
    { key: SID, ids: [SID, "core"] },
  ];
  it("resolves names, labels and 8-char ids; ignores self, unknown and old messages", () => {
    expect(roomFor("core", rooms)).toBe(SID);
    expect(roomFor(SID.slice(0, 8), rooms)).toBe(SID);
    expect(roomFor("nobody", rooms)).toBeNull();
    const now = 500_000;
    const m = (o: Partial<{ ts: number; from_: string; to_: string; session: string }>) => ({
      kind: "session_message",
      ts: now - 1000,
      session: null,
      from_: null,
      to_: null,
      text: "cần API mới",
      ...o,
    });
    const v = visitsFrom(
      [m({ from_: SID, to_: "hq-api" }), m({ from_: "hq-api", to_: "hq-api" }), m({ from_: "x", to_: "y" }), m({ from_: SID, to_: "api", ts: now - 600_000 })],
      rooms,
      now,
    );
    expect(v).toEqual([{ from: SID, to: "hq-api", ts: now - 1000, text: "cần API mới" }]);
  });
});

describe("measurement", () => {
  it("cost per task only when both are known", () => {
    expect(costPerTask(2, 4)).toBe(0.5);
    expect(costPerTask(null, 4)).toBeNull();
    expect(costPerTask(2, 0)).toBeNull();
  });
  it("reads the status-line usage snapshot, rejects unsafe ids", () => {
    fs.mkdirSync(path.join(stateDir(), "usage"), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir(), "usage", `${SID}.json`),
      JSON.stringify({ session_id: SID, cost_usd: 1.25, lines_added: 9, model: "claude-opus-5-5" }),
    );
    expect(readUsage(SID)).toMatchObject({ cost_usd: 1.25, lines_added: 9, model: "claude-opus-5-5", duration_ms: null });
    expect(readUsage("../x")).toBeNull();
    expect(readUsage(SID2)).toBeNull();
  });
  it("rooms without a status line: model and first→last time from the transcript, re-read only when the file moves", () => {
    const cwd = "C:/work/proj";
    const dir = path.join(os.homedir(), ".claude", "projects", "C--work-proj");
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `${SID2}.jsonl`);
    const line = (o: unknown) => `${JSON.stringify(o)}\n`;
    fs.writeFileSync(
      f,
      line({ type: "custom-title", customTitle: "dev2", sessionId: SID2 }) +
        line({ type: "file-history-snapshot", snapshot: { timestamp: "2026-10-21T09:00:00.000Z" } }) +
        line({ type: "user", timestamp: "2026-10-21T09:00:01.000Z", message: { role: "user", content: 'ghi "model":"x" trong tool result' } }) +
        line({ type: "assistant", timestamp: "2026-10-21T09:05:00.000Z", message: { model: "claude-sonnet-5-5", role: "assistant", usage: { input_tokens: 5 } } }),
    );
    const a = readTranscriptStats(SID2, cwd);
    expect(a).toMatchObject({ model: "claude-sonnet-5-5", first: Date.parse("2026-10-21T09:00:00.000Z"), last: Date.parse("2026-10-21T09:05:00.000Z") });
    expect(readTranscriptStats(SID2, cwd)).toBe(a); // same size + mtime: the cached object
    fs.appendFileSync(f, line({ type: "assistant", timestamp: "2026-10-21T10:00:00.000Z", message: { model: "claude-opus-5-5", role: "assistant" } }));
    expect(readTranscriptStats(SID2, cwd)).toMatchObject({ model: "claude-opus-5-5", first: Date.parse("2026-10-21T09:00:00.000Z"), last: Date.parse("2026-10-21T10:00:00.000Z") });
    expect(readTranscriptStats(SID, cwd)).toBeNull();
    expect(readTranscriptStats("hq-dev", cwd)).toBeNull();
  });
});

describe("projects from the session folder", () => {
  it("git root + branch from .git/HEAD, a worktree .git file, and detached HEAD", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "hq-proj-"));
    const repo = path.join(base, "shop");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/feat/cart\n");
    fs.mkdirSync(path.join(repo, "apps", "web"), { recursive: true });
    expect(projectOf(path.join(repo, "apps", "web"), 1)).toEqual({ root: repo, name: "shop", branch: "feat/cart" });
    const wt = path.join(base, "shop-wt");
    const gd = path.join(repo, ".git", "worktrees", "wt");
    fs.mkdirSync(gd, { recursive: true });
    fs.writeFileSync(path.join(gd, "HEAD"), "0123456789abcdef0123456789abcdef01234567\n");
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, ".git"), `gitdir: ${gd}\n`);
    expect(projectOf(wt, 2)).toEqual({ root: wt, name: "shop-wt", branch: "0123456" });
    expect(projectOf(null)).toBeNull();
  });
  it("groups rooms per project root", () => {
    const p = { root: "/w/shop", name: "shop", branch: "main" };
    const g = groupByProject([
      { key: "a", project: p, cwd: "/w/shop" },
      { key: "b", project: { ...p, root: "/W/shop" }, cwd: "/w/shop/x" },
      { key: "c", project: null, cwd: "/tmp/scratch" },
    ]);
    expect(g.map((x) => [x.project.name, x.rooms.map((r) => r.key)])).toEqual([
      ["scratch", ["c"]],
      ["shop", ["a", "b"]],
    ]);
  });
});

describe("owner message to a session started elsewhere (no tmux, all of Windows)", () => {
  it("queues in the session inbox and records delivery 'inbox'", async () => {
    const r = await messagesPOST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session: SID, text: "review PR #24 giúp" } }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.delivery).toBe("inbox");
    expect(body.live).toBe(false);
    expect(body.message).toMatchObject({ session: SID, kind: "owner_message", delivery: "inbox" });
    expect(pendingInbox(SID)).toBe(1);
    const line = JSON.parse(fs.readFileSync(inboxFile(SID), "utf8").trim());
    expect(line.text).toBe("review PR #24 giúp");
    if (process.platform !== "win32") {
      expect(fs.statSync(inboxFile(SID)).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(inboxFile(SID))).mode & 0o777).toBe(0o700);
    }
  });
  it("refuses anything that is not an hq-* name or a session uuid", async () => {
    for (const session of ["../../etc", "core", `${SID}/x`, ""]) {
      const r = await messagesPOST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session, text: "x" } }));
      expect(r.status, session).toBe(422);
    }
    expect(isSessionId("1eb79553")).toBe(false);
  });
});

describe("the 8sync-inbox mod's live marker", () => {
  it("a fresh <id>.live means the mod polls (task enters when idle); stale, missing or unsafe ids do not", async () => {
    const live = path.join(path.dirname(inboxFile(SID)), `${SID}.live`);
    fs.mkdirSync(path.dirname(live), { recursive: true });
    fs.writeFileSync(live, "");
    expect(inboxLive(SID)).toBe(true);
    const r = await messagesPOST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session: SID, text: "ping" } }));
    expect((await r.json()).live).toBe(true);
    const busy = new Date(Date.now() - 3600_000);
    fs.utimesSync(live, busy, busy);
    expect(inboxLive(SID)).toBe(true); // a long turn does not poll: still loaded
    const old = new Date(Date.now() - LIVE_MS - 1000);
    fs.utimesSync(live, old, old);
    expect(inboxLive(SID)).toBe(false);
    expect(inboxLive(SID, old.getTime() + 1000)).toBe(true);
    expect(inboxLive("../x")).toBe(false);
    fs.rmSync(live);
    expect(inboxLive(SID)).toBe(false);
  });
});

describe("handoff between Claude sessions (SendMessage journal)", () => {
  it("files session names and returns them with the messages", () => {
    const db = getDb();
    const a = "aaaaaaaa-0719-4d6f-aaa3-644783ddb0b3";
    const b = "bbbbbbbb-68cb-45aa-9999-000000000001";
    applyMapped(db, mapEvent({ v: 1, ts: 5, kind: "session_message", session_id: a, from: a, to: b, from_name: "core", to_name: "rd", text: "giúp?" })!);
    const rows = messagesAfter(db, { kind: "session_message" }).filter((r) => r.from_ === a);
    expect(rows.map((r) => [r.from_name, r.to_name, r.text])).toEqual([["core", "rd", "giúp?"]]);
  });
});

describe("specialists in a room (SubagentStart/Stop journal)", () => {
  it("start then stop updates one agents row under the session", () => {
    const db = getDb();
    const ev = (kind: string, ts: number) => mapEvent({ v: 1, ts, kind, session_id: SID2, cwd: "/w/x", task_id: "agent-7", subject: "reviewer" });
    applyMapped(db, ev("subagent_start", 10)!);
    type Row = { session: string; agent_type: string; ended_at: number | null };
    let row = db.prepare("SELECT * FROM agents WHERE agent_id = 'agent-7'").get() as Row;
    expect([row.session, row.agent_type, row.ended_at]).toEqual([SID2, "reviewer", null]);
    applyMapped(db, ev("subagent_stop", 20)!);
    row = db.prepare("SELECT * FROM agents WHERE agent_id = 'agent-7'").get() as Row;
    expect(row.ended_at).toBe(20);
    expect(mapEvent({ kind: "subagent_start", session_id: SID2, task_id: "../x" })).toBeNull();
  });
});

describe("what each seat shows", () => {
  const room = { status: "running", state: null as string | null, waiting: null as string | null };
  it("the lead mirrors the session; specialists type while they run; empty seats draw nobody", () => {
    expect(seatState({ key: "lead", active: ["lead"] }, room)).toBe("typing");
    expect(seatState({ key: "lead", active: [] }, { ...room, state: "reading" })).toBe("reading");
    expect(seatState({ key: "lead", active: [] }, { ...room, waiting: "Trust this folder?" })).toBe("waiting");
    expect(seatState({ key: "lead", active: [] }, { ...room, status: "needs_input" })).toBe("waiting");
    expect(seatState({ key: "lead", active: [] }, { ...room, status: "idle", state: "bogus" })).toBe("idle");
    expect(seatState({ key: "lead", active: [] }, { ...room, state: "meeting" })).toBe("meeting");
    expect(seatState({ key: "review", active: ["reviewer"] }, room)).toBe("typing");
    expect(seatState({ key: "review", active: [] }, room)).toBeNull();
  });
});

describe("a running session picked by any of its names (the 'Start a session' bug)", () => {
  const s = { name: SID, session_id: SID, label: "core" };
  it("matches the hq name, the session id, an 8+ char prefix and the label", () => {
    expect([matchesSession(s, SID), matchesSession(s, "core"), matchesSession(s, SID.slice(0, 8))]).toEqual([true, true, true]);
    expect([matchesSession(s, SID.slice(0, 4)), matchesSession(s, "other"), matchesSession(s, null)]).toEqual([false, false, false]);
    expect(matchesSession({ name: "hq-api", session_id: null }, "hq-api")).toBe(true);
  });
});

describe("office totals and formats", () => {
  const u = (cost: number | null) => ({ cost_usd: cost, duration_ms: 60_000, lines_added: 3, lines_removed: 1, context_pct: null, model: null });
  it("sums only what was measured and never dilutes $/task with unmeasured rooms", () => {
    const t = officeTotals([
      { tokens: 1000, usage: u(2), tasks: { done: 4, open: 1 } },
      { tokens: null, usage: null, tasks: { done: 4, open: 0 } },
    ]);
    expect(t).toMatchObject({ rooms: 2, tokens: 1000, cost_usd: 2, done: 8, open: 1, cost_per_task: 0.5, measured: 1, lines_added: 3 });
    const none = officeTotals([{ tokens: null, usage: null, tasks: { done: 2, open: 0 } }]);
    expect([none.cost_usd, none.tokens, none.cost_per_task]).toEqual([null, null, null]);
  });
  it("unknown reads 'chưa đo', not 0", () => {
    expect([fmtUsd(null), fmtTokens(undefined), fmtDuration(null)]).toEqual(["chưa đo", "chưa đo", "chưa đo"]);
    expect([fmtUsd(1.234), fmtUsd(0.004), fmtTokens(1500), fmtTokens(2_300_000), fmtDuration(125 * 60_000)]).toEqual([
      "$1.23",
      "<$0.01",
      "2k",
      "2.3M",
      "2 giờ 5 phút",
    ]);
  });
});

describe("ship-loop state per project", () => {
  it("reads su-code/ship/*/loop.json, skips junk", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-loop-"));
    const ship = path.join(root, "su-code", "ship");
    fs.mkdirSync(path.join(ship, "a"), { recursive: true });
    fs.mkdirSync(path.join(ship, "b"), { recursive: true });
    fs.mkdirSync(path.join(ship, "c"), { recursive: true });
    fs.writeFileSync(path.join(ship, "a", "loop.json"), JSON.stringify({ slug: "a", iter: 3, max_iter: 11, started: 10, stopped: null }));
    fs.writeFileSync(path.join(ship, "b", "loop.json"), JSON.stringify({ slug: "b", iter: 5, started: 20, stopped: "done" }));
    fs.writeFileSync(path.join(ship, "c", "loop.json"), "{not json");
    fs.writeFileSync(path.join(ship, "ACTIVE"), "a");
    expect(readLoops([{ root, name: "shop" }, { root: path.join(root, "missing"), name: "x" }])).toEqual([
      { project: "shop", slug: "b", iter: 5, max_iter: null, started: 20, stopped: "done" },
      { project: "shop", slug: "a", iter: 3, max_iter: 11, started: 10, stopped: null },
    ]);
  });
});

describe("walker sprite", () => {
  it("four walk frames (+ stand and dust) of 18 rows x 12 palette chars that differ", () => {
    expect(WALKER_FRAMES.length).toBe(4);
    expect(WALK_MS.length).toBe(WALKER_FRAMES.length);
    expect(WALK_MS.every((ms) => ms === 150)).toBe(true);
    expect(WALKER_DUST.length).toBe(DUST_MS.length);
    expect(WALKER_DUST.length).toBeGreaterThanOrEqual(2);
    expect(new Set(WALKER_FRAMES.map((f) => f.join())).size).toBe(4);
    expect(WALKER_DUST[0].join()).not.toBe(WALKER_STAND.join());
    for (const f of [...WALKER_FRAMES, ...WALKER_DUST, WALKER_STAND]) {
      expect(f.length).toBe(WALKER_H);
      for (const row of f) {
        expect(row.length).toBe(WALKER_W);
        for (const ch of row) expect(Object.hasOwn(WALKER_PALETTE, ch), ch).toBe(true);
      }
    }
    expect(WALKER_FRAMES[0].join()).not.toBe(WALKER_FRAMES[1].join());
  });
  it("carrying a task: same 4-beat walk with a white paper in front, plus its own stand and dust", () => {
    expect(WALKER_CARRY.length).toBe(WALKER_FRAMES.length);
    expect(WALKER_CARRY_DUST.length).toBe(DUST_MS.length);
    for (const f of [...WALKER_CARRY, ...WALKER_CARRY_DUST, WALKER_CARRY_STAND]) {
      expect(f.length).toBe(WALKER_H);
      for (const row of f) {
        expect(row.length).toBe(WALKER_W);
        for (const ch of row) expect(Object.hasOwn(WALKER_PALETTE, ch), ch).toBe(true);
      }
      expect(f.join()).toMatch(/w/);
    }
    expect(WALKER_PALETTE.w).toBeTruthy();
    WALKER_CARRY.forEach((f, i) => {
      expect(f.join(), `carry#${i}`).not.toBe(WALKER_FRAMES[i].join());
      // the paper: 2 wide, 3 tall, a line of ink in the middle, at chest height in front (x 10..11)
      const dy = f[0] === "............" ? 1 : 0;
      expect(f[8 + dy].slice(10, 12)).toBe("ww");
      expect(f[9 + dy].slice(10, 12)).toBe("oo");
      expect(f[10 + dy].slice(10, 12)).toBe("ww");
      // nothing else changed: same rows outside the paper
      f.forEach((row, y) => expect(row.slice(0, 10), `carry#${i} row ${y}`).toBe(WALKER_FRAMES[i][y].slice(0, 10)));
    });
    expect(new Set(WALKER_CARRY.map((f) => f.join())).size).toBe(4);
    expect(WALKER_CARRY_STAND.join()).not.toBe(WALKER_STAND.join());
    expect(WALKER_FRAMES.join()).not.toMatch(/w/);
  });
});

describe("Board / Giao việc to a session started elsewhere", () => {
  it("stores the task and queues it in the session inbox", async () => {
    const before = pendingInbox(SID2);
    const r = await tasksPOST(req("/api/tasks", { method: "POST", token, origin: ORIGIN, body: { session: SID2, subject: "Sửa giỏ hàng", prio: "P1" } }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ delivery: "inbox", session: SID2, started: false });
    expect(body.task).toMatchObject({ session: SID2, subject: "Sửa giỏ hàng", status: "todo", prio: "P1" });
    expect(pendingInbox(SID2)).toBe(before + 1);
    const last = fs.readFileSync(inboxFile(SID2), "utf8").trim().split(/\r?\n/).pop()!;
    expect(JSON.parse(last).text).toContain("New task: Sửa giỏ hàng");
  });
  it("still refuses names that are neither hq-* nor a session id", async () => {
    const r = await tasksPOST(req("/api/tasks", { method: "POST", token, origin: ORIGIN, body: { session: "core", subject: "x" } }));
    expect(r.status).toBe(422);
  });
  it("addressOf: session id for inbox sessions, the hq name for tmux ones", () => {
    expect(addressOf({ tmux: false, name: "core", session_id: SID })).toBe(SID);
    expect(addressOf({ tmux: true, name: "hq-api", session_id: SID })).toBe("hq-api");
    expect(addressOf({ tmux: false, name: SID, session_id: null })).toBe(SID);
  });
});

describe("seat state in a meeting + clones", () => {
  const room = { status: "running", state: null, waiting: null };
  it("the lead leaves the seat during the meeting; specialists keep working", () => {
    expect(seatState({ key: "lead", active: ["lead"] }, room)).toBe("typing");
    expect(seatState({ key: "lead", active: ["lead"] }, room, true)).toBeNull();
    expect(seatState({ key: "dev", active: ["task"] }, room, true)).toBe("typing");
  });
  it("cloneCount = active agents capped at 3", () => {
    expect(cloneCount({ active: [] })).toBe(0);
    expect(cloneCount({ active: ["a", "b"] })).toBe(2);
    expect(cloneCount({ active: ["a", "b", "c", "d", "e"] })).toBe(3);
  });
});

describe("sprint meetings per project", () => {
  const mk = (key: string, label: string, root: string | null, sid: string | null = null): Room =>
    ({ key, name: key, session_id: sid, label, project: root ? { root, name: path.basename(root), branch: null } : null, meeting: null }) as unknown as Room;
  it("reads only today's su-code/standup file and stamps matching rooms", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-meet-"));
    const now = Date.parse("2026-10-16T09:10:00Z");
    fs.mkdirSync(path.join(root, "su-code", "standup"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "su-code", "standup", "2026-10-16.md"),
      "# Họp sprint 2026-10-16\n\n| Giờ | Phòng | Done | Doing | Blocked |\n|---|---|---|---|---|\n| 09:00 | alpha | d | doing a | - |\n| 09:05 | abcdef12 | d | doing b | - |\n| 09:06 | ghost | d | x | - |\n",
    );
    fs.writeFileSync(path.join(root, "su-code", "standup", "2026-10-15.md"), "| 09:00 | gamma | old | old | - |\n");
    const rooms = [mk("hq-a", "alpha", root), mk("hq-b", "beta", root, "abcdef1234567890"), mk("hq-c", "gamma", root), mk("hq-z", "alpha", null)];
    const ms = loadMeetings(rooms, now);
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ project: path.basename(root), root, date: "2026-10-16", until: Date.parse("2026-10-16T09:36:00Z") });
    expect(ms[0].attendees.map((a) => a.room)).toEqual(["alpha", "abcdef12", "ghost"]);
    expect(rooms[0].meeting).toEqual({ at: Date.parse("2026-10-16T09:00:00Z"), phase: "table" });
    expect(rooms[1].meeting?.phase).toBe("table");
    expect(rooms[2].meeting).toBeNull();
    expect(rooms[3].meeting).toBeNull();
  });
  it("ignores a missing or oversized file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-meet-"));
    const now = Date.parse("2026-10-16T09:10:00Z");
    expect(loadMeetings([mk("a", "alpha", root)], now)).toEqual([]);
    fs.mkdirSync(path.join(root, "su-code", "standup"), { recursive: true });
    fs.writeFileSync(path.join(root, "su-code", "standup", "2026-10-16.md"), "| 09:00 | alpha | d | d | - |\n" + "x".repeat(70 * 1024));
    expect(loadMeetings([mk("a", "alpha", root)], now)).toEqual([]);
  });
});

describe("walker sprite pipeline gates", () => {
  const feet = (f: string[]) => f.map((r) => /[^.]/.test(r)).lastIndexOf(true);
  it("every walker frame is 12×18, the feet contact row is the same in all contact frames, carry keeps the body unchanged except the paper", () => {
    const all = [...WALKER_CLIPS.walk, ...WALKER_CLIPS.carry, ...WALKER_CLIPS.stand];
    for (const f of all) {
      expect(f.length).toBe(18);
      for (const r of f) expect(r.length).toBe(12);
    }
    const contact = [WALKER_CLIPS.walk[0], WALKER_CLIPS.walk[2], ...WALKER_CLIPS.stand, WALKER_CLIPS.carry[0], WALKER_CLIPS.carry[2]];
    expect(new Set(contact.map(feet)).size).toBe(1);
    // no drift: the pass frames keep the feet on the same ground row too
    expect(new Set(all.map(feet)).size).toBe(1);
    WALKER_CLIPS.carry.forEach((c, i) => {
      const changed: [number, number][] = [];
      c.forEach((row, y) => [...row].forEach((ch, x) => ch !== WALKER_CLIPS.walk[i][y][x] && changed.push([x, y])));
      expect(changed.length).toBeLessThanOrEqual(6);
      for (const [x] of changed) expect(x).toBeGreaterThanOrEqual(10);
    });
  });
  it("mirror twice is identity, width unchanged, and really flips", () => {
    for (const f of WALKER_CLIPS.walk) {
      expect(mirror(mirror(f))).toEqual(f);
      expect(mirror(f).every((r) => r.length === WALKER_W)).toBe(true);
    }
    expect(mirror(["ab.."])).toEqual(["..ba"]);
    expect(mirror(WALKER_STAND).join()).not.toBe(WALKER_STAND.join());
  });
});
