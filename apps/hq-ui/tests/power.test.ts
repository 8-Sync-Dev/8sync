import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as AUTO } from "@/app/api/auto/route";
import { POST as SETTINGS } from "@/app/api/machine/power/route";
import { awayFrom, parseAwake, parseDisplayHolders } from "@/lib/server/awake";
import { getToken } from "@/lib/server/auth";
import type { Exec } from "@/lib/server/machine";
import { stateDir } from "@/lib/server/paths";
import { credit, DEFAULTS, dayKey, type Ledger, parseGpuWatts, parseSettings, parseTypeperfWh, power, type Reading, readLedger, runBlocked, sampleOnce, step, summarize, type TeamCtl } from "@/lib/server/power";
import { ORIGIN, req, tempHome } from "./helpers";

const R = (at: number, cpuWh: number | null, gpuW: number | null, cpuWrapWh: number | null = null): Reading => ({ at, cpuWh, gpuW, cpuWrapWh });
const ledger = (o: Partial<Ledger> = {}): Ledger => ({ schema: 1, settings: { ...DEFAULTS }, days: {}, since: null, paused: null, ...o });

describe("power probes", () => {
  it("typeperf: the RAPL Energy counter is picowatt-hours; a decimal comma reads too; junk is null", () => {
    const out = '\r\n"(PDH-CSV 4.0)","\\\\PC\\Energy Meter(RAPL_Package0_PKG)\\Energy"\r\n"10/19/2026 13:13:55.556","228600481641666.000000"\r\nExiting, please wait...\r\n';
    expect(parseTypeperfWh(out)).toBeCloseTo(228.600481641666, 9);
    expect(parseTypeperfWh('"19.10.2026 13:13:55","3600000000000,5"')).toBeCloseTo(3.6, 6);
    expect(parseTypeperfWh("Error: No valid counters.")).toBeNull();
  });
  it("nvidia-smi power.draw: summed over GPUs; [N/A] alone is not 0 W", () => {
    expect(parseGpuWatts("44.67\r\n120.10\r\n")).toBeCloseTo(164.77, 2);
    expect(parseGpuWatts("[N/A]\n")).toBeNull();
  });
});

describe("power accounting", () => {
  it("first reading: GPU and the estimate now, no energy yet", () => {
    const r = step(null, R(0, 10, 45), 60);
    expect(r.add).toBeNull();
    expect(r.live).toMatchObject({ cpuW: null, gpuW: 45, otherW: 60, w: 105 });
  });
  it("15 s apart: CPU from the counter, GPU averaged, the rest from the estimate", () => {
    const cpuWh = (46 * 15) / 3600;
    const r = step(R(0, 10, 40), R(15_000, 10 + cpuWh, 50), 60);
    expect(r.live.cpuW).toBeCloseTo(46, 6);
    expect(r.live.w).toBeCloseTo(46 + 50 + 60, 6);
    expect(r.add!.cpuWh).toBeCloseTo(cpuWh, 9);
    expect(r.add!.gpuWh).toBeCloseTo((45 * 15) / 3600, 9);
    expect(r.add!.wh).toBeCloseTo(((46 + 45 + 60) * 15) / 3600, 9);
  });
  it("a long gap (asleep, stalled) counts only the measured CPU energy, not 60 W times the gap", () => {
    const r = step(R(0, 10, 40), R(3_600_000, 10.5, 40), 60);
    expect(r.add).toEqual({ wh: 0.5, cpuWh: 0.5, gpuWh: 0 });
  });
  it("a counter that went backwards (reboot) is no energy; a Linux counter that wrapped is", () => {
    expect(step(R(0, 50, null), R(15_000, 1, null), 0).add!.cpuWh).toBe(0);
    expect(step(R(0, 72.7, null), R(15_000, 0.1, null, 72.8), 0).add!.cpuWh).toBeCloseTo(0.2, 9);
  });
  it("credit: ₫ at the price of the moment, month = this month's days, old days dropped", () => {
    let l = ledger({ settings: { ...DEFAULTS, vndPerKwh: 3000 } });
    l = credit(l, "2026-09-30", { wh: 1000, cpuWh: 0, gpuWh: 0 }, 1);
    l = credit(l, "2026-10-01", { wh: 2000, cpuWh: 500, gpuWh: 500 }, 2);
    l = { ...l, settings: { ...l.settings, vndPerKwh: 4000 } };
    l = credit(l, "2026-10-01", { wh: 1000, cpuWh: 0, gpuWh: 0 }, 3);
    expect(l.days["2026-10-01"]).toEqual({ wh: 3000, cpuWh: 500, gpuWh: 500, vnd: 10_000 });
    expect(l.since).toBe(1);
    const p = summarize(l, null, new Date(2026, 9, 1, 12).getTime());
    expect(p.today.vnd).toBe(10_000);
    expect(p.month.wh).toBe(3000);
    for (let d = 1; d <= 80; d++) l = credit(l, `2027-01-${String(d).padStart(2, "0")}`, { wh: 1, cpuWh: 0, gpuWh: 0 }, 4);
    expect(Object.keys(l.days)).toHaveLength(70);
  });
  it("settings: checked field by field; null clears the budget; anything out of range is refused", () => {
    expect(parseSettings({ vndPerKwh: 3200.4, budgetVnd: 50_000 }, DEFAULTS)).toEqual({ vndPerKwh: 3200, otherW: 60, budgetVnd: 50_000 });
    expect(parseSettings({ budgetVnd: null }, { ...DEFAULTS, budgetVnd: 9000 })!.budgetVnd).toBeNull();
    for (const bad of [{ vndPerKwh: 0 }, { otherW: -1 }, { budgetVnd: "5000" }, { budgetVnd: 10 }, { vndPerKwh: Number.NaN }]) expect(parseSettings(bad, DEFAULTS)).toBeNull();
  });
});

describe("daily budget", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
  });
  // CPU counter +1 Wh per call: 1 Wh at 3500 ₫/kWh plus the estimate is a few ₫ per sample.
  let counter = 0;
  const run: Exec = async (cmd) => (cmd === "typeperf" ? `"10/19/2026 13:00:00.000","${(counter += 1) * 1e12}"` : cmd === "nvidia-smi" ? "100\n" : null);

  it("over budget: pauses a running team once, keeps it paused, refuses Chạy until the budget is raised", async () => {
    const calls: string[] = [];
    let team = { on: true, paused: false };
    const ctl: TeamCtl = {
      status: async () => (calls.push("status"), team),
      pause: async () => (calls.push("pause"), (team = { on: true, paused: true })),
    };
    await sampleOnce(run, "win32", ctl);
    await sampleOnce(run, "win32", ctl);
    expect(calls).toEqual([]);
    const spent = power()!.today.vnd;
    expect(spent).toBeGreaterThan(0);

    const r = await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { budgetVnd: 1000 } }));
    expect(r.status).toBe(200);
    // Each sample adds ~1 Wh (≈3.5 ₫): keep sampling until today's spend crosses 1.000 ₫.
    for (let i = 0; i < 400 && !power()!.over; i++) await sampleOnce(run, "win32", ctl);
    expect(power()!.over).toBe(true);
    await sampleOnce(run, "win32", ctl);
    expect(calls.filter((c) => c === "pause")).toHaveLength(1);
    expect(power()!.paused?.at).toBeGreaterThan(0);
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir(), "power.json"), "utf8")) as Ledger;
    expect(saved.paused?.day).toBe(dayKey(Date.now()));

    expect(runBlocked()).toMatch(/vượt ngân sách 1\.000 ₫/);
    const blocked = await AUTO(req("/api/auto", { method: "POST", token, origin: ORIGIN, body: { action: "on" } }));
    expect(blocked.status).toBe(409);

    await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { budgetVnd: null } }));
    expect(runBlocked()).toBeNull();
    expect(power()!.over).toBe(false);
  });
  it("settings route: 401 without the token, 422 out of range", async () => {
    expect((await SETTINGS(req("/api/machine/power", { method: "POST", origin: ORIGIN, body: { otherW: 50 } }))).status).toBe(401);
    expect((await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { otherW: 5000 } }))).status).toBe(422);
  });
  it("a budget raised while the team status was being read: no pause", async () => {
    await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { budgetVnd: 1000 } }));
    const calls: string[] = [];
    const ctl: TeamCtl = {
      status: async () => {
        calls.push("status");
        await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { budgetVnd: 9_000_000 } }));
        return { on: true, paused: false };
      },
      pause: async () => (calls.push("pause"), { paused: true }),
    };
    await sampleOnce(run, "win32", ctl);
    expect(calls).toEqual(["status"]);
  });
  it("a pause that didn't take is not recorded, and is not retried for 5 minutes", async () => {
    await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { budgetVnd: 1000 } }));
    const before = power()!.paused?.at;
    const calls: string[] = [];
    const ctl: TeamCtl = { status: async () => (calls.push("status"), { on: true, paused: false }), pause: async () => (calls.push("pause"), { paused: false, error: "8sync missing" }) };
    await sampleOnce(run, "win32", ctl);
    await sampleOnce(run, "win32", ctl);
    expect(calls).toEqual(["status", "pause"]);
    expect(power()!.paused?.at).toBe(before);
    await SETTINGS(req("/api/machine/power", { method: "POST", token, origin: ORIGIN, body: { budgetVnd: null } }));
  });
});

describe("ledger file", () => {
  it("a corrupt power.json is kept aside as power.json.bad and counting starts over; a missing one is fresh", () => {
    tempHome();
    expect(readLedger()!.days).toEqual({});
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(path.join(stateDir(), "power.json"), "{not json");
    expect(readLedger()).toMatchObject({ days: {}, settings: DEFAULTS });
    expect(fs.readFileSync(path.join(stateDir(), "power.json.bad"), "utf8")).toBe("{not json");
    expect(fs.existsSync(path.join(stateDir(), "power.json"))).toBe(false);
  });
  it("a CPU counter jump no package could draw is junk, not a day of energy", () => {
    expect(step(R(0, 0, null), R(15_000, 900, null), 0).add!.cpuWh).toBe(0);
  });
});

describe("awake", () => {
  it("status json: schema 1 only; wrong types become unknown, not true", () => {
    expect(parseAwake('{"schema":1,"held":true,"display_required":false,"display":"off","idle_s":22140.7,"boot_s":28800,"slept_s":0,"modern_standby":false}')).toEqual({
      held: true,
      display_required: false,
      display: "off",
      idle_s: 22140,
      boot_s: 28800,
      slept_s: 0,
      modern_standby: false,
    });
    expect(parseAwake('{"schema":1,"held":"yes","display":"blank","idle_s":-5}')).toMatchObject({ held: null, display: null, idle_s: null });
    expect(parseAwake('{"held":true}')).toBeNull();
    expect(parseAwake("error: không rõ `status`")).toBeNull();
  });
  it("away: rooms whose last turn came after the owner's last input; nothing while the owner is here", () => {
    const now = 10_000_000;
    const rec = (ts: number) => ({ team: "t", name: `n${ts}`, state: "rest", ts, detail: null }) as never;
    expect(awayFrom(3600, [rec(now / 1000 - 4000), rec(now / 1000 - 100), rec(now / 1000 - 10)], now)).toEqual({ since: now - 3_600_000, rooms: 2, last: now - 10_000 });
    expect(awayFrom(120, [rec(now / 1000)], now)).toBeNull();
    expect(awayFrom(null, [], now)).toBeNull();
  });
});

describe("who keeps the screen on", () => {
  it("powercfg /requests: names from the DISPLAY section only; None. is nobody", () => {
    const out = [
      "DISPLAY:",
      "[PROCESS] \\Device\\HarddiskVolume3\\Users\\Admin\\AppData\\Local\\Programs\\Godot-4.7.2\\Godot_v4.7.2-stable_win64.exe",
      "Godot Engine running with display/window/energy_saving/keep_screen_on = true",
      "[PROCESS] \\Device\\HarddiskVolume3\\Users\\Admin\\AppData\\Local\\Programs\\Godot-4.7.2\\Godot_v4.7.2-stable_win64.exe",
      "",
      "SYSTEM:",
      "[DRIVER] NVIDIA High Definition Audio (HDAUDIO\\FUNC_01&VEN_10DE)",
      "[PROCESS] \\Device\\HarddiskVolume3\\Users\\Admin\\AppData\\Local\\Programs\\8sync\\8sync.exe",
    ].join("\r\n");
    expect(parseDisplayHolders(out)).toEqual(["Godot_v4.7.2-stable_win64.exe"]);
    expect(parseDisplayHolders("DISPLAY:\r\nNone.\r\n\r\nSYSTEM:\r\n[DRIVER] X (y)\r\n")).toEqual([]);
  });
});
