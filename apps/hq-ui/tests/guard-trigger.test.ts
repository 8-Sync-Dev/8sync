import { describe, expect, it, vi } from "vitest";

// Never the real 8sync: the trigger's own runner is replaced by a fake in every step() call.
vi.mock("@/lib/server/proc", () => ({ run: vi.fn() }));

import { guardView, limitsOf, loadOf, MAX_GAP_MS, MIN_GAP_MS, newTrigger, parseGuardNow, SAMPLE_MS, step, type GuardNow, type GuardNowResult, type Load, type Trigger } from "@/lib/server/guard-trigger";
import type { Machine } from "@/lib/server/machine";

const low = { cpu: 20, ram: 40, vram: 10 };
const ram = { ...low, ram: 90 };
const ACTED: GuardNowResult = { ok: true, acted: true, skipped: false };
const IDLE: GuardNowResult = { ok: true, acted: false, skipped: false };
const ok = () => vi.fn(async () => ACTED);
const L = { ram: 60, cpu: 60 };

/** Breaching RAM samples every 5 s up to `untilMs`, each run answering `result`: the start times (s). */
async function starts(t: Trigger, result: () => GuardNowResult, untilMs: number, fromMs = 0) {
  const at: number[] = [];
  for (let ms = fromMs; ms <= untilMs; ms += SAMPLE_MS) {
    const p = step(t, ram, L, ms, async () => result());
    if (p) {
      at.push(ms / 1000);
      await p;
    }
  }
  return at;
}

/** Feed samples 5 s apart from `t0`; the index of each sample that started a run. */
function feed(t: Trigger, loads: Load[], now: GuardNow, t0 = 0) {
  const fired: number[] = [];
  loads.forEach((l, i) => {
    if (step(t, l, L, t0 + i * SAMPLE_MS, now)) fired.push(i);
  });
  return fired;
}

describe("guard trigger", () => {
  it("CPU ≥ pct fires on the 3rd sample in a row, a low sample resets the streak", () => {
    const now = ok();
    const cpu = { ...low, cpu: 97 };
    expect(feed(newTrigger(), [cpu, cpu, low, cpu, cpu], now)).toEqual([]);
    const t = newTrigger();
    expect(feed(t, [cpu, cpu, cpu], now)).toEqual([2]);
    expect(t.running).toBe("CPU 97% ×3");
    expect(now).toHaveBeenCalledTimes(1);
  });
  it("RAM ≥ pct fires on the 2nd sample, VRAM ≥ 90 on the 2nd; below stays quiet", () => {
    const now = ok();
    expect(feed(newTrigger(), [{ ...low, ram: 61 }, low, { ...low, ram: 61 }], now)).toEqual([]);
    const r = newTrigger();
    expect(feed(r, [{ ...low, ram: 61 }, { ...low, ram: 62 }], now)).toEqual([1]);
    expect(r.running).toBe("RAM 62% ×2");
    const v = newTrigger();
    expect(feed(v, [{ ...low, vram: 89 }, { ...low, vram: 89 }, { ...low, vram: 95 }, { ...low, vram: 95 }], now)).toEqual([3]);
    expect(v.running).toBe("VRAM 95% ×2");
    // null (not measured) never counts.
    expect(feed(newTrigger(), [{ cpu: null, ram: null, vram: null } as never, { cpu: null, ram: null, vram: null } as never, { cpu: null, ram: null, vram: null } as never], now)).toEqual([]);
  });
  it("RAM and CPU thresholds apart: CPU 57% fires at CPU 55 but not RAM 60; RAM 58% never counts against CPU 55", () => {
    const split = { ram: 60, cpu: 55 };
    const cpu = { ...low, cpu: 57 };
    const t = newTrigger();
    [cpu, cpu].forEach((l, i) => expect(step(t, l, split, i * SAMPLE_MS, ok())).toBeNull());
    expect(step(t, cpu, split, 2 * SAMPLE_MS, ok())).not.toBeNull();
    expect(t.running).toBe("CPU 57% ×3");
    const r = newTrigger();
    for (let i = 0; i < 5; i++) expect(step(r, { ...low, ram: 58 }, split, i * SAMPLE_MS, ok())).toBeNull();
    expect(limitsOf({ pct: 60, cpuPct: 55 })).toEqual(split);
    expect(limitsOf({ pct: 60, cpuPct: null })).toEqual(L);
    expect(limitsOf({ pct: null, cpuPct: 55 })).toBeNull();
    expect(limitsOf(null)).toBeNull();
  });
  it("single-flight: no second run while one is in flight; the streak restarts when a run starts", async () => {
    let finish: (v: GuardNowResult) => void = () => {};
    const now = vi.fn(() => new Promise<GuardNowResult>((r) => (finish = r)));
    const t = newTrigger();
    expect(step(t, ram, L, 0, now)).toBeNull();
    const first = step(t, ram, L, SAMPLE_MS, now);
    expect(first).not.toBeNull();
    expect(t.ram).toBe(0);
    // Long past the gap, still breaching, but the first run hasn't returned.
    for (let i = 1; i <= 10; i++) expect(step(t, ram, L, i * MIN_GAP_MS, now)).toBeNull();
    expect(now).toHaveBeenCalledTimes(1);
    finish({ ok: false, acted: false, skipped: false });
    await first;
    expect(t.running).toBeNull();
    expect(t.lastRun).toEqual({ at: 5, ok: false, why: "RAM 90% ×2", acted: false });
    // Samples during the run kept counting: once it returns, the next breaching sample runs again.
    expect(t.ram).toBe(10);
    expect(step(t, ram, L, 20 * MIN_GAP_MS, now)).not.toBeNull();
    expect(now).toHaveBeenCalledTimes(2);
  });
  it("at least 20 s between starts (start to start), then fires on the next breaching sample", async () => {
    const now = ok();
    const t = newTrigger();
    // Samples at 0, 5 s (fires), 10, 15, 20, 25 s: the gap allows the next start only from 25 s.
    expect(step(t, ram, L, 0, now)).toBeNull();
    await step(t, ram, L, SAMPLE_MS, now);
    expect(now).toHaveBeenCalledTimes(1);
    expect(feed(t, [ram, ram, ram, ram], now, 2 * SAMPLE_MS)).toEqual([3]);
    expect(now).toHaveBeenCalledTimes(2);
  });
  it("a runner that throws counts as a failed run and frees the trigger", async () => {
    const t = newTrigger();
    await step(t, { ...low, ram: 90 }, L, 0, async () => {
      throw new Error("boom");
    });
    // The streak needed 2 samples; the first one only counted.
    expect(t.lastRun).toBeNull();
    await step(t, { ...low, ram: 90 }, L, SAMPLE_MS, async () => {
      throw new Error("boom");
    });
    expect(t).toMatchObject({ running: null, lastRun: { ok: false, why: "RAM 90% ×2", acted: false }, gapMs: 2 * MIN_GAP_MS });
  });
  it("back-off: runs that change nothing double the gap 20 → 40 → 80 → 160 → 300 s (cap)", async () => {
    const t = newTrigger();
    const at = await starts(t, () => IDLE, 1_200_000);
    expect(at).toEqual([5, 45, 125, 285, 585, 885, 1185]);
    expect(at.slice(1).map((s, i) => s - at[i])).toEqual([40, 80, 160, 300, 300, 300]);
    expect(t.gapMs).toBe(MAX_GAP_MS);
  });
  it("back-off resets to 20 s when a run acts", async () => {
    const t = newTrigger();
    // Three idle runs (gap now 160 s), then one that acts: after it, the gap is 20 s again.
    expect(await starts(t, () => IDLE, 125_000)).toEqual([5, 45, 125]);
    expect(t.gapMs).toBe(8 * MIN_GAP_MS);
    expect(await starts(t, () => ACTED, 310_000, 130_000)).toEqual([285, 305]);
    expect(t.gapMs).toBe(MIN_GAP_MS);
    expect(t.lastRun).toMatchObject({ acted: true, at: 305 });
  });
  it("back-off resets to 20 s after 2 samples with nothing over (the breach cleared), not after one quiet sample", async () => {
    const t = newTrigger();
    await starts(t, () => IDLE, 45_000);
    expect(t.gapMs).toBe(4 * MIN_GAP_MS);
    // Still over: the gap holds.
    step(t, ram, L, 50_000, async () => IDLE);
    expect(t.gapMs).toBe(4 * MIN_GAP_MS);
    // One quiet sample of a noisy load: the gap holds.
    step(t, low, L, 55_000, async () => IDLE);
    expect(t.gapMs).toBe(4 * MIN_GAP_MS);
    step(t, low, L, 60_000, async () => IDLE);
    expect(t.gapMs).toBe(MIN_GAP_MS);
    // A new breach runs 20 s after the last start (45 s): at 70 s, its 2nd sample.
    expect(await starts(t, () => IDLE, 75_000, 65_000)).toEqual([70]);
  });
  it("a skipped run (revive held the lock) counts as not acted and reads 'revive đang chạy'", async () => {
    const t = newTrigger();
    await starts(t, () => ({ ok: true, acted: false, skipped: true }), 5_000);
    expect(t.lastRun).toEqual({ at: 5, ok: true, why: "revive đang chạy", acted: false });
    expect(t.gapMs).toBe(2 * MIN_GAP_MS);
  });
  it("guard now --json: acted only from the contract object; junk, failure or skipped = not acted", () => {
    expect(parseGuardNow({ ok: true, stdout: '{"acted":true,"skipped":null,"rows":[{"name":"dev2","role":"dev","state":"restarted"}]}' })).toEqual(ACTED);
    expect(parseGuardNow({ ok: true, stdout: '{"acted":false,"skipped":null,"rows":[]}' })).toEqual(IDLE);
    expect(parseGuardNow({ ok: true, stdout: '{"acted":false,"skipped":"revive","rows":[]}' })).toEqual({ ok: true, acted: false, skipped: true });
    expect(parseGuardNow({ ok: true, stdout: '{"acted":true,"skipped":"revive"}' })).toMatchObject({ acted: false, skipped: true });
    for (const stdout of ["revive đang chạy…", "", "[]", "null", '{"acted":"yes"}', '{"rows":[]}', "{"]) {
      expect(parseGuardNow({ ok: true, stdout })).toEqual({ ok: false, acted: false, skipped: false });
    }
    expect(parseGuardNow({ ok: false, stdout: '{"acted":true}' })).toEqual({ ok: false, acted: false, skipped: false });
  });
  it("load: RAM share and the fullest GPU's VRAM", () => {
    const m = { mem: { totalMb: 1000, usedMb: 750 }, cpu: { cores: 8, pct: 55 }, gpus: [{ name: "a", util: 0, memUsed: 10, memTotal: 100, temp: null }, { name: "b", util: 0, memUsed: 92, memTotal: 100, temp: null }] } as Machine;
    expect(loadOf(m)).toEqual({ cpu: 55, ram: 75, vram: 92 });
    expect(loadOf({ ...m, gpus: null })).toMatchObject({ vram: null });
  });
  it("view: null without a guard, else the guard plus running / lastRun", () => {
    expect(guardView(null)).toBeNull();
    const g = { pct: 60, cpuPct: 55, eco: null, cap: null, capN: null, cpus: null, capTight: false, projects: [], temp_qa: null };
    expect(guardView(g)).toEqual({ ...g, running: false, runningWhy: null, lastRun: null, nextGapS: 20 });
  });
});
