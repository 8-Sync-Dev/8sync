import { describe, expect, it } from "vitest";
import type { FloorRow } from "@/lib/floor";
import { findingsKey, normWatch, parseScan, SPIKE_GAP_MS, spikeStep, spikeZero, WATCH_DEFAULT, watchChanged, watchText, watchTick, type Levels, type Scan, type WatchDeps } from "@/lib/server/machine-watch";

const scan = (over: Partial<Scan> = {}): Scan => ({
  at: 1,
  ram: 91,
  cpu: 40,
  memMb: { total: 65536, used: 59000 },
  gpus: [{ name: "RTX", util: 5, memUsed: 6000, memTotal: 16000 }],
  procs: 400,
  top: [{ image: "ego", n: 36, cpu: 6.5, mb: 17000 }],
  suspects: [
    { kind: "duplicate", image: "node", reason: "2 bản node", keep: "1:10", kill: ["2:20"], canKill: true, procs: [{ id: "1:10", pid: 1, image: "node", mb: 100, cpu: 0, procs: 1, ageMin: 60, cmd: "node vite" }, { id: "2:20", pid: 2, image: "node", mb: 100, cpu: 0, procs: 1, ageMin: 1, cmd: "node vite" }] },
    { kind: "duplicate", image: "omp", reason: "2 bản omp", keep: "3:1", kill: [], canKill: false, procs: [] },
  ],
  ...over,
});

describe("machine watch", () => {
  it("defaults to off, every 30 minutes, and only keeps valid settings", () => {
    expect(normWatch(null)).toEqual(WATCH_DEFAULT);
    expect(WATCH_DEFAULT.everyMin).toBe(30);
    const c = normWatch({ on: true, room: "omp-0123456789abcdef", everyMin: 7, cpu: 150, ram: 10, evil: 1 });
    expect(c).toEqual({ ...WATCH_DEFAULT, on: true, room: "omp-0123456789abcdef", cpu: 99, ram: 30 });
    // A partial update keeps the rest; a bad room id keeps the old one; null clears it.
    expect(normWatch({ everyMin: 60, room: "../x" }, c)).toEqual({ ...c, everyMin: 60 });
    expect(normWatch({ room: null }, c).room).toBeNull();
  });

  it("fires a spike only after it holds two ticks, then not again for 15 minutes", () => {
    const cfg = { ...WATCH_DEFAULT, on: true };
    const hot = { cpu: 97, ram: 50, gpu: null };
    let st = spikeZero();
    let r = spikeStep(st, hot, cfg, 0);
    expect(r.fire).toEqual([]);
    r = spikeStep(r.next, hot, cfg, 60_000);
    expect(r.fire).toEqual(["cpu"]);
    r = spikeStep(r.next, hot, cfg, 120_000);
    expect(r.fire).toEqual([]);
    // A dip resets the run; held again after the gap fires again.
    r = spikeStep(r.next, { ...hot, cpu: 10 }, cfg, 180_000);
    st = r.next;
    expect(st.over.cpu).toBe(0);
    r = spikeStep(st, hot, cfg, 60_000 + SPIKE_GAP_MS);
    r = spikeStep(r.next, hot, cfg, 120_000 + SPIKE_GAP_MS);
    expect(r.fire).toEqual(["cpu"]);
  });

  it("keys a routine pass on what can be killed, so protected-only findings send nothing", () => {
    expect(findingsKey(scan())).toBe("duplicate:2:20");
    expect(findingsKey(scan({ suspects: scan().suspects.slice(1) }))).toBe("");
  });

  it("tells the room to look before killing and names the ids", () => {
    const t = watchText("spike", "CPU 97% ≥ 85% suốt 2 phút", scan(), Date.UTC(2026, 10, 7, 8, 0));
    expect(t).toMatch(/^\[HQ Canh máy · KHẨN: CPU 97%/);
    expect(t).toContain("KHÔNG kill ngay");
    expect(t).toContain("kill được: 2:20");
    expect(t).toContain("được bảo vệ, chỉ báo");
    expect(t).toContain("8sync ccc eco kill <pid:start>");
  });

  it("reads eco scan JSON and rejects anything else", () => {
    expect(parseScan(JSON.stringify(scan()))?.suspects).toHaveLength(2);
    expect(parseScan("{\"heavy\":[]}")).toBeNull();
    expect(parseScan("error: usage")).toBeNull();
  });

  it("a tick sends a routine pass once, holds back the same findings, and lets a spike through", async () => {
    watchChanged();
    const ROOM = "omp-0123456789abcdef";
    const row = { id: "r", name: "core", title: "core", live: true, inbox_id: ROOM, engine: "omp", repo: "~/x" } as unknown as FloorRow;
    const sent: string[] = [];
    let lv: Levels = { cpu: 20, ram: 50, gpu: 5 };
    let found = scan();
    const deps: Partial<WatchDeps> = {
      floor: async () => [row],
      live: () => true,
      scan: async () => found,
      levels: async () => lv,
      deliver: (_r, id, text) => sent.push(`${id}|${text}`),
    };
    const cfg = { ...WATCH_DEFAULT, on: true, room: ROOM };
    const t0 = 1_800_000_000_000;
    expect(await watchTick(t0, cfg, deps)).toEqual({ sent: "routine", session: ROOM });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/^omp-0123456789abcdef\|\[HQ Canh máy · định kỳ\]/);
    // Inside the interval: nothing. Next interval, same killable findings: skipped, not sent.
    expect(await watchTick(t0 + 60_000, cfg, deps)).toBeNull();
    expect(await watchTick(t0 + 31 * 60_000, cfg, deps)).toEqual({ skipped: expect.stringContaining("không có gì mới") });
    // Only protected findings: nothing to send either.
    found = scan({ suspects: scan().suspects.slice(1) });
    expect(await watchTick(t0 + 62 * 60_000, cfg, deps)).toEqual({ skipped: expect.stringContaining("không có gì kill được") });
    expect(sent).toHaveLength(1);
    // RAM held over the line for two ticks: urgent at once, whatever the interval.
    lv = { cpu: 20, ram: 95, gpu: 5 };
    expect(await watchTick(t0 + 63 * 60_000, cfg, deps)).toBeNull();
    expect(await watchTick(t0 + 64 * 60_000, cfg, deps)).toEqual({ sent: "spike", session: ROOM });
    expect(sent[1]).toContain("KHẨN: RAM 95% ≥ 90% suốt 2 phút");
    // A room that is no longer live is skipped with a reason, not queued.
    watchChanged();
    expect(await watchTick(t0 + 200 * 60_000, cfg, { ...deps, live: () => false, scan: async () => scan({ suspects: [{ ...scan().suspects[0], kill: ["9:9"] }] }) })).toEqual({ skipped: expect.stringContaining("không live") });
    expect(sent).toHaveLength(2);
    // Off: no reads at all.
    expect(await watchTick(t0 + 300 * 60_000, { ...cfg, on: false }, { ...deps, levels: async () => { throw new Error("read"); } })).toBeNull();
  });
});
