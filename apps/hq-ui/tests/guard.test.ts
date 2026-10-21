import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", () => ({ run }));

import { autoStatus } from "@/lib/server/auto";
import { guardArgv, parseGuard, setGuard } from "@/lib/server/guard";

beforeEach(() => run.mockReset());

const project = {
  root: "C:\\Users\\x\\3d-game",
  level: 2,
  at: 1792400000,
  ram: 72,
  cpu: 41.5,
  defender_cpu: 3.2,
  paused: ["review2", "dev6"],
  actions: [{ at: 1792400000, text: "L1: dọn 3 tiến trình (1.2 GB)" }],
  defender: "Add-MpPreference -ExclusionPath 'C:\\x\\.claude\\worktrees'",
  rooms: [
    { name: "dev2", mb: 1800, cpu: 24 },
    { name: "lead", mb: 900, cpu: null },
  ],
  top: ["MCP codebase-memory 24% (dev2)", "msmpeng 4% (máy)"],
  breach: { ram: 1792399990, ram_hi: null, cpu: 1792399980, cpu_max: null },
  last: { at: 1792400000, text: "L1: dọn 3 tiến trình (1.2 GB)" },
};
const tempQa = { mb: 4200, dirs: 7, partial: true, at: 1792400000 };

describe("parseGuard", () => {
  it("accepts the contract shape", () => {
    const none = { cpuPct: null, cap: null, capN: null, cpus: null, capTight: false };
    expect(parseGuard({ pct: 60, eco: true, projects: [project], temp_qa: tempQa })).toEqual({ pct: 60, eco: true, ...none, projects: [project], temp_qa: tempQa });
    expect(parseGuard({ pct: 60, cpu_pct: 55, eco: true, cap: 37, cap_n: 6, cpus: 32, cap_tight: true, projects: [] })).toMatchObject({ pct: 60, cpuPct: 55, cap: 37, capN: 6, cpus: 32, capTight: true });
    expect(parseGuard({ pct: null, cpu_pct: 55, projects: [] })?.cpuPct).toBeNull();
    for (const bad of [9, 91, 37.5, "37", -1]) expect(parseGuard({ pct: 55, cpu_pct: typeof bad === "number" && bad >= 30 ? 96 : bad, cap: bad, cap_n: 0, cpus: 65, cap_tight: "yes", projects: [] })).toMatchObject(none);
    // An older 8sync without eco/rooms/top/breach/last/temp_qa: the switch hides, the lists are empty.
    const old: Record<string, unknown> = { ...project };
    for (const k of ["rooms", "top", "breach", "last"]) delete old[k];
    expect(parseGuard({ pct: 60, projects: [old] })).toEqual({ pct: 60, eco: null, ...none, projects: [{ ...project, rooms: [], top: [], breach: null, last: null }], temp_qa: null });
    expect(parseGuard({ pct: null, projects: [{ ...project, at: null, ram: null, defender: null }] })?.projects[0]).toMatchObject({ at: null, ram: null, defender: null });
  });
  it("breach, last and temp_qa: strict, a bad value → null (the guard stays)", () => {
    const p = parseGuard({ pct: 60, projects: [{ ...project, breach: { ram: -5, ram_hi: "x", cpu: Infinity, cpu_max: 1792400000 }, last: { at: "now", text: "x" } }] })?.projects[0];
    expect(p?.breach).toEqual({ ram: null, ram_hi: null, cpu: null, cpu_max: 1792400000 });
    expect(p?.last).toBeNull();
    expect(parseGuard({ pct: 60, projects: [{ ...project, breach: [1], last: { at: 1, text: "y".repeat(999) } }] })?.projects[0]).toMatchObject({ breach: null, last: { at: 1, text: "y".repeat(300) } });
    for (const bad of [{ ...tempQa, mb: -1 }, { ...tempQa, mb: NaN }, { ...tempQa, dirs: 1.5 }, { ...tempQa, partial: "yes" }, { ...tempQa, at: null }, [tempQa], "4 GB"]) {
      expect(parseGuard({ pct: 60, projects: [], temp_qa: bad })?.temp_qa).toBeNull();
    }
  });
  it("missing or malformed → null", () => {
    expect(parseGuard(undefined)).toBeNull();
    expect(parseGuard([])).toBeNull();
    expect(parseGuard({ pct: 60 })).toBeNull();
    expect(parseGuard({ pct: "60", projects: [] })).toBeNull();
    expect(parseGuard({ pct: 60.5, projects: [] })).toBeNull();
    expect(parseGuard({ pct: 60, projects: [{ ...project, level: 4 }] })).toBeNull();
    expect(parseGuard({ pct: 60, projects: [{ ...project, at: Infinity }] })).toBeNull();
    expect(parseGuard({ pct: 60, projects: [{ ...project, root: 5 }] })).toBeNull();
  });
  it("caps strings and arrays", () => {
    const g = parseGuard({ pct: 60, projects: [{ ...project, defender: "x".repeat(999), actions: Array.from({ length: 30 }, (_, i) => ({ at: i, text: "a" })) }] });
    expect(g?.projects[0].defender).toHaveLength(300);
    expect(g?.projects[0].actions).toHaveLength(10);
    expect(g?.projects[0].actions.at(-1)?.at).toBe(29);
  });
  it("cpu and defender_cpu: a finite 0..100, else null (the project stays)", () => {
    for (const bad of [-1, 101, NaN, Infinity, "5", undefined, null]) {
      const p = parseGuard({ pct: 60, projects: [{ ...project, cpu: bad, defender_cpu: bad }] })?.projects[0];
      expect(p).toMatchObject({ root: project.root, cpu: null, defender_cpu: null });
    }
    expect(parseGuard({ pct: 60, projects: [{ ...project, cpu: 0, defender_cpu: 100 }] })?.projects[0]).toMatchObject({ cpu: 0, defender_cpu: 100 });
  });
  it("rooms and top: bad entries dropped, caps (rooms ≤ 20, names ≤ 64, top ≤ 3), eco only a boolean", () => {
    const rooms = [
      { name: "x".repeat(99), mb: 10, cpu: 150 },
      { name: "neg", mb: -1, cpu: 1 },
      { name: "inf", mb: Infinity, cpu: 1 },
      { name: "", mb: 1, cpu: 1 },
      "dev",
      ...Array.from({ length: 30 }, (_, i) => ({ name: `r${i}`, mb: i, cpu: 1 })),
    ];
    const g = parseGuard({ pct: 60, eco: "yes", projects: [{ ...project, rooms, top: ["a", 5, "b", "c", "d"] }] });
    expect(g?.eco).toBeNull();
    const p = g!.projects[0];
    expect(p.rooms).toHaveLength(20);
    expect(p.rooms[0]).toEqual({ name: "x".repeat(64), mb: 10, cpu: null });
    expect(p.rooms.some((r) => ["neg", "inf", ""].includes(r.name))).toBe(false);
    expect(p.top).toEqual(["a", "b", "c"]);
    expect(parseGuard({ pct: 60, eco: false, projects: [] })?.eco).toBe(false);
  });
  it("auto status carries guard, null when absent", async () => {
    run.mockResolvedValueOnce({ ok: true, stdout: JSON.stringify({ on: true, paused: false, guard: { pct: 70, projects: [] } }), stderr: "" });
    expect((await autoStatus()).guard).toEqual({ pct: 70, cpuPct: null, eco: null, cap: null, capN: null, cpus: null, capTight: false, projects: [], temp_qa: null });
    run.mockResolvedValueOnce({ ok: true, stdout: '{"on":true,"paused":false}', stderr: "" });
    expect((await autoStatus()).guard).toBeNull();
  });
});

describe("guardArgv", () => {
  it("exactly one of pct (30..95 integer or null), cpu (30..95 integer), cap (10..90 integer or null) or eco (boolean) reaches argv", () => {
    expect(guardArgv({ pct: 60 })).toEqual(["ccc", "auto", "guard", "60"]);
    expect(guardArgv({ pct: 30 })).toEqual(["ccc", "auto", "guard", "30"]);
    expect(guardArgv({ pct: 95 })).toEqual(["ccc", "auto", "guard", "95"]);
    expect(guardArgv({ pct: null })).toEqual(["ccc", "auto", "guard", "off"]);
    expect(guardArgv({ eco: true })).toEqual(["ccc", "auto", "guard", "eco", "on"]);
    expect(guardArgv({ eco: false })).toEqual(["ccc", "auto", "guard", "eco", "off"]);
    expect(guardArgv({ cap: 37 })).toEqual(["ccc", "auto", "guard", "cap", "37"]);
    expect(guardArgv({ cap: 10 })).toEqual(["ccc", "auto", "guard", "cap", "10"]);
    expect(guardArgv({ cap: 90 })).toEqual(["ccc", "auto", "guard", "cap", "90"]);
    expect(guardArgv({ cap: null })).toEqual(["ccc", "auto", "guard", "cap", "off"]);
    expect(guardArgv({ cpu: 55 })).toEqual(["ccc", "auto", "guard", "cpu", "55"]);
    for (const bad of [29, 96, 55.5, "55", null, "off", undefined, NaN, "55; rm -rf /", [55]]) expect(guardArgv({ cpu: bad })).toBeNull();
    for (const bad of [9, 91, 37.5, "37", "off", undefined, NaN, "37; rm -rf /", [37]]) expect(guardArgv({ cap: bad })).toBeNull();
    for (const bad of [29, 96, 60.5, "60", "off", undefined, NaN, Infinity, "60; rm -rf /", [60]]) expect(guardArgv({ pct: bad })).toBeNull();
    for (const bad of ["on", 1, null, undefined]) expect(guardArgv({ eco: bad })).toBeNull();
    for (const body of [null, undefined, {}, [], "pct", { pct: 60, eco: true }, { pct: null, eco: false }, { pct: 60, cap: 37 }, { cap: 37, eco: true }, { pct: 60, cpu: 55 }, { cpu: 55, cap: 37 }]) expect(guardArgv(body)).toBeNull();
  });
  it("setGuard runs the argv with a 15 s timeout and returns the first line", async () => {
    run.mockResolvedValueOnce({ ok: true, stdout: "guard: 70%\nmore", stderr: "" });
    expect(await setGuard(["ccc", "auto", "guard", "70"])).toEqual({ ok: true, message: "guard: 70%" });
    expect(run).toHaveBeenCalledWith("8sync", ["ccc", "auto", "guard", "70"], 15_000);
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: bad pct\n" });
    expect(await setGuard(["ccc", "auto", "guard", "70"])).toEqual({ ok: false, message: "bad pct" });
  });
});
