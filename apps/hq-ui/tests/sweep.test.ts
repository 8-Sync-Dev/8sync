import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type Out = { ok: boolean; stdout: string; stderr: string };
const status = vi.hoisted(() => ({ v: {} as Record<string, unknown> }));
const run = vi.hoisted(() =>
  vi.fn<(cmd: string, args: string[], timeout?: number, cwd?: string) => Promise<Out>>(async (_c, args) =>
    args.includes("status") ? { ok: true, stdout: JSON.stringify(status.v), stderr: "" } : { ok: true, stdout: "ok", stderr: "" },
  ),
);
vi.mock("@/lib/server/proc", async (orig) => ({ ...(await orig<typeof import("@/lib/server/proc")>()), run, mergedSessions: vi.fn(async () => []) }));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/machine/sweep/route";
import { ALERT_EVERY_MS, alertText, BACKOFF_MAX_MS, BACKOFF_MIN_MS, ENSURE_AGAIN_MS, isSweepRoom, loadIsTheirs, nextBackoff, sweepArgs } from "@/lib/sweep";
import type { AutoStatus } from "@/lib/server/auto";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { resetSweep, runningTeams, setSweep, sweepAlert, sweepOn, sweepTick, sweepView, type SweepDeps } from "@/lib/server/sweep";
import { ORIGIN, req, tempHome } from "./helpers";

const repo = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-sweep-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return path.resolve(dir);
};
type Sess = { name: string; label: string; cwd: string; status: string };
const deps = (st: Partial<AutoStatus> | null, sessions: Sess[] = []): SweepDeps => ({ status: async () => st as AutoStatus | null, sessions: async () => sessions });
const sweepRoom = (cwd: string): Sess => ({ name: "3698e3a6-0000", label: "sweep", cwd, status: "running" });
const ups = () => run.mock.calls.filter((c) => c[1].includes("--add"));

describe("pure rules", () => {
  it("fixed argv, names like room.rs, doubling backoff, one-line alert", () => {
    expect(sweepArgs(true)).toEqual(["ccc", "auto", "up", "--add", "sweep"]);
    expect(sweepArgs(false)).toEqual(["ccc", "auto", "down", "--only", "sweep"]);
    for (const n of ["sweep", "sweep2", "sweep-zus", "Sweeper"]) expect(isSweepRoom(n), n).toBe(true);
    for (const n of ["lead", "eye", "sw", "", null, "dev-sweep"]) expect(isSweepRoom(n), String(n)).toBe(false);
    expect(nextBackoff(null)).toBe(BACKOFF_MIN_MS);
    expect(nextBackoff(BACKOFF_MIN_MS)).toBe(2 * BACKOFF_MIN_MS);
    expect(nextBackoff(BACKOFF_MAX_MS)).toBe(BACKOFF_MAX_MS);
    const t = alertText("CPU 72% ×3", ["MCP codebase-memory 24% (dev2)", "node 9% (ui)"]);
    expect(t.startsWith("[máy] CPU 72% ×3 · top: MCP codebase-memory 24% (dev2), node 9% (ui)")).toBe(true);
    expect(t).not.toContain("\n");
    expect(runningTeams({ on: true, paused: false, team_roots: ["C:/a", 3, ""] })).toEqual(["C:/a"]);
    expect(runningTeams({ on: true, paused: true, team_roots: ["C:/a"] })).toEqual([]);
    expect(runningTeams({ on: false, paused: false, team_roots: ["C:/a"] })).toEqual([]);
    expect(runningTeams({ on: true, paused: false }), "older 8sync: no team_roots").toEqual([]);
    // Auto's scope: `repos` (none = every project) and `out` (closed) filter stale team roots.
    const roots = ["C:/p/a", "C:/p/b", "C:/p/c"];
    expect(runningTeams({ on: true, paused: false, team_roots: roots, repos: ["c:\\P\\A\\", "C:/p/b"] })).toEqual(["C:/p/a", "C:/p/b"]);
    expect(runningTeams({ on: true, paused: false, team_roots: roots, repos: [], out: ["C:/p/b"] })).toEqual(["C:/p/a", "C:/p/c"]);
    expect(runningTeams({ on: true, paused: false, team_roots: ["C:/p/a/sub"], repos: ["C:/p/a"] })).toEqual(["C:/p/a/sub"]);
    expect(runningTeams({ on: true, paused: false, team_roots: ["C:/p/ab"], repos: ["C:/p/a"] })).toEqual([]);
    // The load is the project's own only when a top CPU user is one of its rooms; the guard level is
    // machine-wide (every project's pass is up during any breach), so it alone alerts nobody.
    expect(loadIsTheirs({ level: 0, top: ["MCP codebase-memory 24% (dev2)"] })).toBe(true);
    expect(loadIsTheirs({ level: 2, top: [] })).toBe(false);
    expect(loadIsTheirs({ level: 2, top: ["rustc 30% (máy)"] })).toBe(false);
    expect(loadIsTheirs({ level: 0, top: ["chrome 40% (máy)", "node 0% (dev)"] })).toBe(false);
    expect(loadIsTheirs({ level: 0, top: [] })).toBe(false);
    expect(loadIsTheirs(undefined)).toBe(false);
  });
});

describe("ensure, switch, alert", () => {
  let token = "";
  let root = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
  });
  beforeEach(() => {
    resetSweep();
    run.mockClear();
    root = repo();
    status.v = { on: true, paused: false, team_roots: [root] };
  });
  const post = (body: unknown, auth = true) => POST(req("/api/machine/sweep", { method: "POST", token: auth ? token : null, origin: ORIGIN, body }));

  it("adds the sweep to a running team by default, never to a paused one or one that has it", async () => {
    const db = getDb();
    expect(sweepOn(db, root)).toBe(true);
    expect(await sweepTick(db, 1_000, deps({ on: true, paused: true, team_roots: [root] }))).toEqual([]);
    expect(await sweepTick(db, 1_000, deps({ on: true, paused: false, team_roots: [root] }, [sweepRoom(path.join(root, ".claude", "worktrees", "card-3"))]))).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(await sweepTick(db, 1_000, deps(status.v))).toEqual([root]);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "up", "--add", "sweep"], 180_000, root);
    // Done: not asked again for 10 min even if the room list misses it, then again.
    expect(await sweepTick(db, 1_000 + ENSURE_AGAIN_MS - 1, deps(status.v))).toEqual([]);
    expect(await sweepTick(db, 1_000 + ENSURE_AGAIN_MS, deps(status.v))).toEqual([root]);
    expect(ups().length).toBe(2);
    expect(sweepView(db, status.v as AutoStatus)).toEqual([{ root, name: path.basename(root), on: true, live: false, busy: false, error: null, retryAt: null }]);
  });

  it("one pass at a time; a failure backs off 5 min, doubling", async () => {
    const db = getDb();
    const gate = Promise.withResolvers<Out>();
    run.mockImplementationOnce(() => gate.promise);
    const first = sweepTick(db, 0, deps(status.v));
    await vi.waitFor(() => expect(ups().length).toBe(1));
    expect(await sweepTick(db, 0, deps(status.v)), "single flight").toEqual([]);
    gate.resolve({ ok: false, stdout: "", stderr: "Error: team của dự án này chưa chạy" });
    expect(await first).toEqual([]);
    expect(sweepView(db, status.v as AutoStatus)[0]).toMatchObject({ error: "team của dự án này chưa chạy", retryAt: BACKOFF_MIN_MS });
    expect(await sweepTick(db, BACKOFF_MIN_MS - 1, deps(status.v))).toEqual([]);
    expect(ups().length).toBe(1);
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "boom" });
    expect(await sweepTick(db, BACKOFF_MIN_MS, deps(status.v))).toEqual([]);
    expect(ups().length).toBe(2);
    expect(sweepView(db, status.v as AutoStatus)[0].retryAt).toBe(BACKOFF_MIN_MS + 2 * BACKOFF_MIN_MS);
    expect(await sweepTick(db, 3 * BACKOFF_MIN_MS, deps(status.v))).toEqual([root]);
    expect(sweepView(db, status.v as AutoStatus)[0]).toMatchObject({ error: null, retryAt: null });
  });

  it("the switch: gated route, off stops only the sweep and is remembered once that worked, the loop then leaves it off", async () => {
    const db = getDb();
    expect((await post({ root, on: false }, false)).status).toBe(401);
    expect((await post({ root, on: "no" })).status).toBe(422);
    expect((await post({ root: path.join(os.tmpdir(), "not-a-team"), on: false })).status).toBe(409);
    expect(run.mock.calls.filter((c) => !c[1].includes("status"))).toEqual([]);

    // A failed stop (revive lock held) keeps the switch on and says why: never "tắt" over a live room.
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: auto revive đang chạy" });
    const failed = await post({ root, on: false });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ ok: false, on: true, error: "auto revive đang chạy" });
    expect(sweepOn(db, root)).toBe(true);

    const off = await post({ root: root.toUpperCase(), on: false });
    expect(off.status).toBe(200);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "down", "--only", "sweep"], 60_000, root);
    expect(sweepOn(db, root)).toBe(false);
    run.mockClear();
    expect(await sweepTick(db, 10, deps(status.v))).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(sweepView(db, status.v as AutoStatus)[0].on).toBe(false);

    expect((await post({ root, on: true })).status).toBe(200);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "up", "--add", "sweep"], 180_000, root);
    expect(sweepOn(db, root)).toBe(true);
    // Just added by the switch: the loop does not add it a second time.
    run.mockClear();
    expect(await sweepTick(db, Date.now(), deps(status.v))).toEqual([]);
    expect(run).not.toHaveBeenCalled();
    expect(await setSweep(db, root, true)).toMatchObject({ ok: true, on: true });
  });

  it("guard alert: only projects whose own rooms carry the load, one line to a live sweep, at most once per 5 min per project", async () => {
    const db = getDb();
    const other = repo();
    const proj = (r: string, top: string[], level = 0) => ({ root: r, level, top });
    const st = {
      ...status.v,
      team_roots: [root, other],
      guard: { pct: 60, eco: true, temp_qa: null, projects: [proj(root, ["MCP codebase-memory 24% (dev2)"]), proj(other, ["chrome 40% (máy)"])] },
    } as unknown as AutoStatus;
    expect(await sweepAlert(db, "CPU 72% ×3", 0, deps(st)), "no sweep room yet: nothing sent").toEqual([]);
    expect(run).not.toHaveBeenCalled();
    const live = deps(st, [sweepRoom(root), sweepRoom(other)]);
    expect(await sweepAlert(db, "CPU 72% ×3", 0, live), "the other project's load is not its rooms'").toEqual([root]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "msg", "sweep", alertText("CPU 72% ×3", ["MCP codebase-memory 24% (dev2)"])], 30_000, root);
    expect(await sweepAlert(db, "RAM 81% ×2", ALERT_EVERY_MS - 1, live)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    // A failed send does not use up the window.
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "x" });
    expect(await sweepAlert(db, "CPU 90% ×3", ALERT_EVERY_MS, live)).toEqual([]);
    expect(await sweepAlert(db, "CPU 90% ×3", ALERT_EVERY_MS + 1, live)).toEqual([root]);
    // Switch off: no alert.
    await setSweep(db, root, false);
    run.mockClear();
    expect(await sweepAlert(db, "CPU 90% ×3", 10 * ALERT_EVERY_MS, live)).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
