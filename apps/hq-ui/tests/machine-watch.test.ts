import { describe, expect, it } from "vitest";
import { findingsKey, normWatch, parseScan, SPIKE_GAP_MS, spikeStep, spikeZero, WATCH_DEFAULT, watchText, type Scan } from "@/lib/server/machine-watch";

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
});
