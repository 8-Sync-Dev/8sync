import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const office = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/office", () => ({ loadOffice: office }));
vi.mock("@/lib/server/db", () => ({ getDb: () => ({}) }));

import { pruneTicked, STALE_MS, TICK_EVERY_MS, TICK_IDLE_MS, TICK_PROMPT, TICK_SLACK_MS, tickTargets, type TickRoom } from "@/lib/auto-tick";
import { runAutoTick } from "@/lib/server/auto-tick";
import { stateDir } from "@/lib/server/paths";
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
  it("skips without inboxLive, with pending, or without session_id", () => {
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

  it("never throws; the detail stays out of the response", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    office.mockRejectedValue(new Error("boom /home/x/secret"));
    expect(await runAutoTick({ on: true, paused: false }, NOW)).toEqual({ ticked: [], error: "tick failed" });
    expect(err).toHaveBeenCalledWith("auto-tick:", "boom /home/x/secret");
    err.mockRestore();
  });
});
