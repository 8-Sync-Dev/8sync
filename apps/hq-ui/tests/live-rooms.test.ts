// Regression (2026-10-21): "⚡ Đang Sấm Sét" stayed on for 3d-game after its boost rooms were stopped.
// `claude agents` timed out on a crawling machine, so every old journal row (dev6, review2, qa2, …)
// came back with its stored status and the 13-room boost team looked alive.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** What each binary answers: `claude agents` / `tmux` / `8sync ls`; null = the call fails (timeout). */
const bins = vi.hoisted(() => ({ claude: null as string | null, tmux: null as string | null, ls: "[]" }));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  execFile: (file: string, args: string[], _opts: unknown, cb: (err: (Error & { killed?: boolean }) | null, out: string, errOut: string) => void) => {
    const out = /claude/.test(file) ? bins.claude : /tmux/.test(file) ? bins.tmux : args[0] === "ls" ? bins.ls : null;
    setImmediate(() => (out == null ? cb(Object.assign(new Error("timed out"), { killed: true }), "", "") : cb(null, out, "")));
    return {} as never;
  },
}));

import { boostOn } from "@/components/hq/team-controls";
import { groupByRepo } from "@/lib/sidebar";
import { getDb } from "@/lib/server/db";
import { loadFloor, resetFloorCache } from "@/lib/server/floor";
import { loadOffice } from "@/lib/server/office";
import { listClaudeAgents, mergedSessions, resetAgentsCache } from "@/lib/server/proc";
import { tempHome } from "./helpers";

const BOOST = ["lead", "ba", "dev", "dev2", "dev3", "dev4", "dev5", "dev6", "ui", "qa", "qa2", "review", "review2"];
const DEV = "1eb79553-8369-4a90-b428-2dedb50e18db";
let game = "";

beforeAll(() => {
  tempHome();
  game = fs.mkdtempSync(path.join(os.tmpdir(), "hq-3d-game-"));
  fs.mkdirSync(path.join(game, ".git"));
  fs.writeFileSync(path.join(game, ".git", "HEAD"), "ref: refs/heads/main\n");
  // The journal still holds the stopped boost rooms as idle / running.
  const ins = getDb().prepare("INSERT INTO sessions(name, project_id, started_at, status, cwd, role, updated_at) VALUES (?, NULL, ?, ?, ?, ?, 1)");
  BOOST.forEach((r, i) => ins.run(`hq-3d-game-${r}`, 1000 + i, i % 2 ? "running" : "idle", game, r));
  // `8sync ls --json --all`: the registry rooms, none running.
  bins.ls = JSON.stringify(BOOST.map((r) => ({ name: r, title: r, repo: game, engine: "ccc", status: "idle", last_active: 1 })));
});
beforeEach(() => {
  resetAgentsCache();
  resetFloorCache();
  bins.claude = null;
  bins.tmux = null;
});

const gameRooms = async () => {
  const office = await loadOffice(getDb());
  return groupByRepo(office.rooms).find((g) => path.resolve(g.project.root) === path.resolve(game))?.rooms ?? [];
};

describe("rooms count only when alive", () => {
  it("`claude agents` failing never resurrects journal rows: 3d-game runs 0 rooms and Sấm Sét is off", async () => {
    const merged = await mergedSessions(getDb());
    expect(merged.filter((s) => s.cwd === game).map((s) => s.status)).toEqual(BOOST.map(() => "ended"));
    expect(await gameRooms()).toEqual([]);
    expect(boostOn((await loadOffice(getDb())).rooms)).toBe(false);
    // The registry rows stay on the floor, but none is live.
    expect((await loadFloor(getDb())).filter((r) => r.live)).toEqual([]);
  });

  it("the last good `claude agents` answer stands in for 2 minutes, then nothing", async () => {
    bins.claude = JSON.stringify([{ pid: 7, cwd: game, sessionId: DEV, name: "dev", status: "idle" }]);
    const t0 = Date.now();
    expect(await listClaudeAgents(() => t0)).toHaveLength(1);
    bins.claude = null;
    expect(await listClaudeAgents(() => t0 + 119_999)).toHaveLength(1);
    expect(await listClaudeAgents(() => t0 + 120_000)).toBeNull();
  });

  it("an alive session still counts: the one room in `claude agents` is the only running room", async () => {
    bins.claude = JSON.stringify([{ pid: 7, cwd: game, sessionId: DEV, name: "dev", status: "busy" }]);
    const rooms = await gameRooms();
    expect(rooms.map((r) => r.status)).toEqual(["running"]);
    expect(boostOn(rooms)).toBe(false);
  });

  it("boostOn: 13 alive rooms with dev6/qa2/review2 is on; the same names ended are off", () => {
    const rooms = BOOST.map((r) => ({ name: `hq-3d-game-${r}`, label: r, status: "running" }));
    expect(boostOn(rooms)).toBe(true);
    expect(boostOn(rooms.map((r) => (/dev6|qa2|review2/.test(r.label) ? { ...r, status: "ended" } : r)))).toBe(false);
  });
});
