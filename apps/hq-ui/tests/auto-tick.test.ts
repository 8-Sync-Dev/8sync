import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const office = vi.hoisted(() => vi.fn());
const proc = vi.hoisted(() => vi.fn(async () => ({ ok: true, stdout: "", stderr: "" })));
vi.mock("@/lib/server/office", () => ({ loadOffice: office }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({}) }));
// Never the real 8sync: `auto revive` would resume the owner's rooms on this machine.
vi.mock("@/lib/server/proc", () => ({ run: proc }));

import { pruneTicked, STALE_MS, TICK_EVERY_MS, TICK_IDLE_MS, TICK_PROMPT, TICK_SLACK_MS, tickTargets, type TickRoom } from "@/lib/auto-tick";
import { NO_TICK_MS, REVIVE_MS, runAutoTick } from "@/lib/server/auto-tick";
import { idleStatusDir, stateDir } from "@/lib/server/paths";
import { tempHome } from "./helpers";

const SID = "11111111-2222-4333-8444-555555555555";
const NOW = 1_000_000_000_000;
const room = (o: Partial<TickRoom> = {}): TickRoom => ({ session_id: SID, status: "idle", inboxLive: true, pending: 0, idleSince: NOW - TICK_IDLE_MS, ...o });

describe("tickTargets", () => {
  it("ticks an idle live session", () => expect(tickTargets([room()], {}, NOW)).toEqual([SID]));
  it("skips idle < 60 s minus the poll slack", () => {
    expect(tickTargets([room({ idleSince: NOW - 50_000 })], {}, NOW)).toEqual([]);
    expect(tickTargets([room({ idleSince: NOW - TICK_IDLE_MS + TICK_SLACK_MS })], {}, NOW)).toEqual([SID]);
  });
  it("skips every status but idle (running / needs_input / ended / unknown)", () => {
    for (const status of ["running", "needs_input", "ended", "stale", ""]) expect(tickTargets([room({ status })], {}, NOW)).toEqual([]);
  });
  it("skips without inboxLive, with pending, without session_id, or with noTick", () => {
    expect(tickTargets([room({ noTick: true })], {}, NOW)).toEqual([]);
    expect(tickTargets([room({ inboxLive: false })], {}, NOW)).toEqual([]);
    expect(tickTargets([room({ pending: 1 })], {}, NOW)).toEqual([]);
    expect(tickTargets([room({ session_id: null })], {}, NOW)).toEqual([]);
  });
  it("re-tick only after 10 min", () => {
    expect(tickTargets([room()], { [SID]: NOW - TICK_EVERY_MS + 1 }, NOW)).toEqual([]);
    expect(tickTargets([room()], { [SID]: NOW - TICK_EVERY_MS }, NOW)).toEqual([SID]);
  });
});

describe("pruneTicked", () => {
  it("drops entries older than 24 h", () => {
    expect(pruneTicked({ a: NOW - 25 * 3600_000, b: NOW - 1000 }, NOW)).toEqual({ b: NOW - 1000 });
  });
});

describe("runAutoTick", () => {
  const live = { session_id: SID, status: "idle", inboxLive: true, pending: 0 };
  const inbox = () => path.join(stateDir(), "inbox", `${SID}.jsonl`);
  const state = () => path.join(stateDir(), "auto-tick.json");
  beforeEach(() => {
    tempHome();
    office.mockReset();
    office.mockResolvedValue({ rooms: [live] });
  });

  it("off, paused or gated: reads and writes nothing", async () => {
    expect(await runAutoTick({ on: false, paused: false }, NOW)).toEqual({ ticked: [] });
    expect(await runAutoTick({ on: true, paused: true }, NOW)).toEqual({ ticked: [] });
    expect(await runAutoTick({ on: true, paused: false, gate: "lease hết hạn" }, NOW)).toEqual({ ticked: [] });
    expect(office).not.toHaveBeenCalled();
    expect(fs.existsSync(state())).toBe(false);
    expect(fs.existsSync(inbox())).toBe(false);
  });

  it("on: first sighting waits, 60 s later queues exactly one prompt, no repeat within 10 min", async () => {
    const on = { on: true, paused: false };
    expect((await runAutoTick(on, NOW)).ticked).toEqual([]);
    expect((await runAutoTick(on, NOW + TICK_IDLE_MS)).ticked).toEqual([SID]);
    const lines = fs.readFileSync(inbox(), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).text).toBe(TICK_PROMPT);
    expect((await runAutoTick(on, NOW + 2 * TICK_IDLE_MS)).ticked).toEqual([]);
    expect(fs.readFileSync(inbox(), "utf8").trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(state(), "utf8")).schema).toBe(1);
  });

  it("idle-since memory restarts after a gap in polls (pause, tab closed)", async () => {
    const on = { on: true, paused: false };
    expect((await runAutoTick(on, NOW)).ticked).toEqual([]);
    // Paused for longer than STALE_MS: the pause path writes nothing, the old idle entry is stale.
    expect(await runAutoTick({ on: true, paused: true }, NOW + STALE_MS)).toEqual({ ticked: [] });
    const back = NOW + STALE_MS + 1;
    expect((await runAutoTick(on, back)).ticked).toEqual([]);
    expect(fs.existsSync(inbox())).toBe(false);
    expect((await runAutoTick(on, back + TICK_IDLE_MS)).ticked).toEqual([SID]);
  });

  it("two concurrent polls queue one prompt (write-then-rename state)", async () => {
    const on = { on: true, paused: false };
    expect((await runAutoTick(on, NOW)).ticked).toEqual([]);
    const both = await Promise.all([runAutoTick(on, NOW + TICK_IDLE_MS), runAutoTick(on, NOW + TICK_IDLE_MS)]);
    expect(both.flatMap((r) => r.ticked)).toEqual([SID]);
    expect(fs.readFileSync(inbox(), "utf8").trim().split("\n")).toHaveLength(1);
    expect(fs.readdirSync(stateDir()).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("asks 8sync to revive dead team rooms at most once per 2 minutes, never while held", async () => {
    proc.mockClear();
    const revives = () => proc.mock.calls.filter((c) => JSON.stringify(c).includes("revive")).length;
    await runAutoTick({ on: true, paused: false, gate: "lease hết hạn" }, NOW);
    expect(revives()).toBe(0);
    await runAutoTick({ on: true, paused: false }, NOW);
    expect(proc).toHaveBeenCalledWith("8sync", ["ccc", "auto", "revive"], REVIVE_MS);
    await runAutoTick({ on: true, paused: false }, NOW + REVIVE_MS - 1);
    expect(revives()).toBe(1);
    await runAutoTick({ on: true, paused: false }, NOW + REVIVE_MS);
    expect(revives()).toBe(2);
  });

  it("with Lease liên tục on, still asks revive while gated (its lease tick, its wake after the usage window) but wakes nobody itself", async () => {
    proc.mockClear();
    const revives = () => proc.mock.calls.filter((c) => JSON.stringify(c).includes("revive")).length;
    const held = { on: true, paused: false, gate: "chạm trần gói subscription", lease_auto: true };
    expect((await runAutoTick(held, NOW)).ticked).toEqual([]);
    expect(revives()).toBe(1);
    expect((await runAutoTick(held, NOW + TICK_IDLE_MS)).ticked).toEqual([]);
    expect(fs.existsSync(inbox())).toBe(false);
  });

  it("tight usage with pins: the unpinned project's idle room gets no tick", async () => {
    office.mockResolvedValue({ rooms: [{ ...live, cwd: "C:\\code\\other", project: null }] });
    const tight = { on: true, paused: false, focus: true, pins: ["C:\\code\\pinned"] };
    expect((await runAutoTick(tight, NOW)).ticked).toEqual([]);
    expect((await runAutoTick(tight, NOW + TICK_IDLE_MS)).ticked).toEqual([]);
    expect(fs.existsSync(inbox())).toBe(false);
    // The same room once its project is pinned: ticked as before (first sighting, then the idle wait).
    const pinned = { ...tight, pins: ["C:\\code\\other"] };
    expect((await runAutoTick(pinned, NOW + TICK_IDLE_MS)).ticked).toEqual([]);
    expect((await runAutoTick(pinned, NOW + 2 * TICK_IDLE_MS)).ticked).toEqual([SID]);
  });

  it("auto on --here in one project: the other project's idle room gets no tick (owner 2026-10-21: inbox leak)", async () => {
    office.mockResolvedValue({ rooms: [{ ...live, cwd: "C:\\code\\other", project: { root: "C:\\code\\other", name: "other", branch: null } }] });
    const scoped = { on: true, paused: false, repos: ["\\\\?\\C:\\code\\ide"], out: [] };
    expect((await runAutoTick(scoped, NOW)).ticked).toEqual([]);
    expect((await runAutoTick(scoped, NOW + TICK_IDLE_MS)).ticked).toEqual([]);
    expect((await runAutoTick(scoped, NOW + 2 * TICK_IDLE_MS)).ticked).toEqual([]);
    expect(fs.existsSync(inbox())).toBe(false);
    // The same room once its project is in scope (a worktree of it counts), unless `auto close` took it out.
    const inScope = { ...scoped, repos: ["\\\\?\\C:\\code\\ide", "C:/code/OTHER"] };
    expect((await runAutoTick(inScope, NOW + 3 * TICK_IDLE_MS)).ticked).toEqual([]);
    expect((await runAutoTick(inScope, NOW + 4 * TICK_IDLE_MS)).ticked).toEqual([SID]);
    const closed = { ...inScope, out: ["C:\\code\\other"] };
    expect((await runAutoTick(closed, NOW + 5 * TICK_IDLE_MS)).ticked).toEqual([]);
  });

  it("never throws; the detail stays out of the response", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    office.mockRejectedValue(new Error("boom /home/x/secret"));
    expect(await runAutoTick({ on: true, paused: false }, NOW)).toEqual({ ticked: [], error: "tick failed" });
    expect(err).toHaveBeenCalledWith("auto-tick:", "boom /home/x/secret");
    err.mockRestore();
  });

  it("skips a session whose own Stop hook said no_tick (own cron loop, or a team room with no lane)", async () => {
    const dir = idleStatusDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `session-${SID.slice(0, 8)}__lead.json`);
    const status = { schema: 1, team: `session-${SID.slice(0, 8)}`, name: "lead", state: "rest", detail: "có loop cron riêng", ts: NOW / 1000, no_tick: "cron" };
    fs.writeFileSync(file, JSON.stringify(status));
    const on = { on: true, paused: false };
    expect((await runAutoTick(on, NOW)).ticked).toEqual([]);
    expect((await runAutoTick(on, NOW + TICK_IDLE_MS)).ticked).toEqual([]);
    expect(fs.existsSync(inbox())).toBe(false);
    // The flag gone (the loop was deleted): ticks again.
    fs.writeFileSync(file, JSON.stringify({ ...status, no_tick: false, state: "working" }));
    expect((await runAutoTick(on, NOW + 2 * TICK_IDLE_MS)).ticked).toEqual([SID]);
  });

  it("ignores a no_tick: cron older than the cron period + 5 min (the loop is gone); events holds", async () => {
    expect(NO_TICK_MS).toBe(35 * 60_000);
    const dir = idleStatusDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `session-${SID.slice(0, 8)}__lead.json`);
    const rec = (no_tick: unknown) => JSON.stringify({ schema: 1, team: `session-${SID.slice(0, 8)}`, name: "lead", state: "rest", detail: "x", ts: NOW / 1000, no_tick });
    fs.writeFileSync(file, rec("cron"));
    const on = { on: true, paused: false };
    const t = NOW + NO_TICK_MS - TICK_IDLE_MS;
    expect((await runAutoTick(on, t)).ticked).toEqual([]);
    // Still fresh at exactly 35 min: skipped.
    expect((await runAutoTick(on, t + TICK_IDLE_MS)).ticked).toEqual([]);
    // Past 35 min: the flag is stale and the idle session ticks.
    expect((await runAutoTick(on, t + TICK_IDLE_MS + 1_000)).ticked).toEqual([SID]);
    // A room without a board lane ("events") stays skipped however old the record is (polls 60 s
    // apart, past the 10-min re-tick, so only the flag holds it back).
    fs.writeFileSync(file, rec("events"));
    const u = t + 2 * TICK_EVERY_MS;
    expect((await runAutoTick(on, u)).ticked).toEqual([]);
    expect((await runAutoTick(on, u + TICK_IDLE_MS)).ticked).toEqual([]);
    // A bare `true` from an older 8sync counts as cron: it expires too.
    fs.writeFileSync(file, rec(true));
    expect((await runAutoTick(on, u + 2 * TICK_IDLE_MS)).ticked).toEqual([SID]);
  });
});
