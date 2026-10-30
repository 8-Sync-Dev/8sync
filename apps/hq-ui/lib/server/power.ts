// "Điện" in the Máy chip: watts now, kWh and VND today and this month, and a daily VND budget.
// Measured: CPU package energy (Windows "Energy Meter" RAPL counter through `typeperf`; Linux
// powercap `energy_uj` when readable) and GPU board power (`nvidia-smi power.draw`). Estimated: the
// rest of the box (board, RAM, disks, fans, PSU loss) as the owner's `otherW`. A 15 s timer started
// by instrumentation.ts keeps counting with no tab open. Over budget: the Máy chip says so.
import fs from "node:fs";
import path from "node:path";
import { coreGet } from "./core";
import { exec, type Exec } from "./machine";
import { stateDir } from "./paths";

export const SAMPLE_MS = 15_000;
/** More than this from one CPU package is a counter that restarted from junk, not energy. */
const MAX_CPU_W = 2000;
/** A longer gap (machine asleep, process stalled): only the measured CPU counter is trusted. */
export const MAX_GAP_MS = 90_000;
const KEEP_DAYS = 70;
/** Unsaved samples at most (one minute); a crash loses no more than that. */
const SAVE_EVERY = 4;

export type PowerSettings = { vndPerKwh: number; otherW: number; budgetVnd: number | null };
/** EVN household tiers 4 to 6 plus 8 % VAT land around 3.200 to 3.700 ₫/kWh; a PC on all day bills at the top tiers. */
export const DEFAULTS: PowerSettings = { vndPerKwh: 3500, otherW: 60, budgetVnd: null };
export const LIMITS = { vndPerKwh: [500, 20_000], otherW: [0, 1000], budgetVnd: [1000, 10_000_000] } as const;

export type Use = { wh: number; cpuWh: number; gpuWh: number; vnd: number };
export type Ledger = {
  schema: 1;
  settings: PowerSettings;
  /** Local day "YYYY-MM-DD" -> use. */
  days: Record<string, Use>;
  /** First sample ever counted (ms). */
  since: number | null;
};
/** One probe. `cpuWh`: the cumulative counter in Wh; `cpuWrapWh`: where it wraps (Linux), else null. */
export type Reading = { at: number; cpuWh: number | null; cpuWrapWh: number | null; gpuW: number | null };
/** `cpuCounter`: the CPU counter answered (its watts need two readings, so `cpuW` is null on the first). */
export type Live = { at: number; cpuW: number | null; cpuCounter: boolean; gpuW: number | null; otherW: number; w: number };
export type Power = {
  live: Live | null;
  vndPerHour: number | null;
  today: Use;
  month: Use;
  settings: PowerSettings;
  since: number | null;
  /** Today's spend reached the budget. */
  over: boolean;
};

const ZERO: Use = { wh: 0, cpuWh: 0, gpuWh: 0, vnd: 0 };

export const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** `typeperf "\Energy Meter(RAPL_Package0_PKG)\Energy" -sc 1`: the counter is in picowatt-hours. */
export function parseTypeperfWh(out: string): number | null {
  for (const line of out.split(/\r?\n/)) {
    const f = [...line.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    if (f.length < 2 || !/^\d/.test(f[0]) || !/^\d/.test(f[1].trim())) continue;
    const v = Number(f[1].trim().replace(",", "."));
    if (Number.isFinite(v) && v >= 0) return v / 1e12;
  }
  return null;
}

/** `nvidia-smi --query-gpu=power.draw --format=csv,noheader,nounits`: the sum over GPUs; null when none reports. */
export function parseGpuWatts(out: string): number | null {
  let sum = 0;
  let any = false;
  for (const line of out.split(/\r?\n/)) {
    const s = line.trim();
    if (!/^\d+(\.\d+)?$/.test(s)) continue;
    sum += Number(s);
    any = true;
  }
  return any ? sum : null;
}

/** Watts now, and the energy since `prev` (null on the first reading). */
export function step(prev: Reading | null, cur: Reading, otherW: number): { live: Live; add: Omit<Use, "vnd"> | null } {
  const dt = prev ? cur.at - prev.at : 0;
  let cpuWh: number | null = null;
  if (prev && prev.cpuWh != null && cur.cpuWh != null) {
    let d = cur.cpuWh - prev.cpuWh;
    if (d < 0 && cur.cpuWrapWh) d += cur.cpuWrapWh;
    // A reset (reboot, driver reload) is not negative energy, and a jump no CPU could draw is junk.
    const most = (Math.max(dt, SAMPLE_MS) / 3_600_000) * MAX_CPU_W;
    cpuWh = d >= 0 && d <= most ? d : null;
  }
  const cpuW = cpuWh != null && dt > 0 ? (cpuWh * 3_600_000) / dt : null;
  const live: Live = { at: cur.at, cpuW, cpuCounter: cur.cpuWh != null, gpuW: cur.gpuW, otherW, w: (cpuW ?? 0) + (cur.gpuW ?? 0) + otherW };
  if (!prev) return { live, add: null };
  // Time-based parts only over a sane interval: a gap (asleep, stalled) or a clock step back counts none.
  const hours = dt > 0 && dt <= MAX_GAP_MS ? dt / 3_600_000 : 0;
  const gpuAvg = cur.gpuW != null && prev.gpuW != null ? (cur.gpuW + prev.gpuW) / 2 : cur.gpuW;
  const gpuWh = gpuAvg == null ? 0 : gpuAvg * hours;
  const c = cpuWh ?? 0;
  return { live, add: { wh: c + gpuWh + otherW * hours, cpuWh: c, gpuWh } };
}

/** Adds `add` to day `day` at today's price; drops days older than KEEP_DAYS. */
export function credit(l: Ledger, day: string, add: Omit<Use, "vnd">, at: number): Ledger {
  const u = l.days[day] ?? ZERO;
  const days = { ...l.days, [day]: { wh: u.wh + add.wh, cpuWh: u.cpuWh + add.cpuWh, gpuWh: u.gpuWh + add.gpuWh, vnd: u.vnd + (add.wh / 1000) * l.settings.vndPerKwh } };
  const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
  return { ...l, days: Object.fromEntries(keep.map((k) => [k, days[k]])), since: l.since ?? at };
}

export const overBudget = (l: Ledger, day: string) => l.settings.budgetVnd != null && (l.days[day]?.vnd ?? 0) >= l.settings.budgetVnd;

export function summarize(l: Ledger, live: Live | null, now: number): Power {
  const day = dayKey(now);
  const month = Object.entries(l.days)
    .filter(([k]) => k.startsWith(day.slice(0, 8)))
    .reduce((a, [, u]) => ({ wh: a.wh + u.wh, cpuWh: a.cpuWh + u.cpuWh, gpuWh: a.gpuWh + u.gpuWh, vnd: a.vnd + u.vnd }), ZERO);
  return {
    live,
    vndPerHour: live ? (live.w / 1000) * l.settings.vndPerKwh : null,
    today: l.days[day] ?? ZERO,
    month,
    settings: l.settings,
    since: l.since,
    over: overBudget(l, day),
  };
}

const num = (v: unknown, [lo, hi]: readonly [number, number]) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Settings from a request body: every field checked; `budgetVnd: null` clears the budget. Null when any field is bad. */
export function parseSettings(body: Record<string, unknown> | null, cur: PowerSettings): PowerSettings | null {
  if (!body) return null;
  const out = { ...cur };
  if ("vndPerKwh" in body) {
    const v = num(body.vndPerKwh, LIMITS.vndPerKwh);
    if (v == null) return null;
    out.vndPerKwh = Math.round(v);
  }
  if ("otherW" in body) {
    const v = num(body.otherW, LIMITS.otherW);
    if (v == null) return null;
    out.otherW = Math.round(v);
  }
  if ("budgetVnd" in body) {
    if (body.budgetVnd === null) out.budgetVnd = null;
    else {
      const v = num(body.budgetVnd, LIMITS.budgetVnd);
      if (v == null) return null;
      out.budgetVnd = Math.round(v);
    }
  }
  return out;
}

const file = () => path.join(stateDir(), "power.json");

function fresh(): Ledger {
  return { schema: 1, settings: { ...DEFAULTS }, days: {}, since: null };
}

/**
 * The saved ledger; a missing file is a fresh one. Null when the file exists but can't be read
 * right now (locked by a scanner): the caller retries and never overwrites it with an empty one.
 * A corrupt file is moved aside to `power.json.bad` and counting starts over.
 */
export function readLedger(): Ledger | null {
  let text: string;
  try {
    text = fs.readFileSync(file(), "utf8");
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT" ? fresh() : null;
  }
  try {
    const j = JSON.parse(text);
    if (j?.schema !== 1 || !j.settings || typeof j.settings !== "object" || Array.isArray(j.settings)) throw new Error("not a ledger");
    const settings = parseSettings(j.settings, DEFAULTS) ?? { ...DEFAULTS };
    const days: Record<string, Use> = {};
    for (const [k, u] of Object.entries(j.days && typeof j.days === "object" ? j.days : {})) {
      const x = (u ?? {}) as Partial<Use>;
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && [x.wh, x.cpuWh, x.gpuWh, x.vnd].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)) days[k] = x as Use;
    }
    const since = typeof j.since === "number" && Number.isFinite(j.since) ? j.since : null;
    return { schema: 1, settings, days, since };
  } catch {
    try {
      fs.renameSync(file(), `${file()}.bad`);
    } catch {
      return null;
    }
    console.error("[hq] power: power.json unreadable, kept as power.json.bad; counting starts over");
    return fresh();
  }
}

/**
 * Write-then-rename: a crash mid-write must not lose the month. On Windows a scanner holding the
 * old file for a moment makes the rename fail (EPERM): retry briefly, then report false so the
 * caller keeps the ledger in memory and saves again at the next sample.
 */
function writeLedger(l: Ledger): boolean {
  const f = file();
  const tmp = `${f}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify(l), { mode: 0o600 });
    for (let i = 1; ; i++) {
      try {
        fs.renameSync(tmp, f);
        return true;
      } catch (e) {
        if (i >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * i);
      }
    }
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    console.error("[hq] power: ledger not saved, retrying next sample:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** The CPU package counter, cumulative Wh. */
export async function readCpu(platform: NodeJS.Platform = process.platform, run: Exec = exec): Promise<{ wh: number; wrapWh: number | null } | null> {
  if (platform === "win32") {
    const out = await run("typeperf", ["\\Energy Meter(RAPL_Package0_PKG)\\Energy", "-sc", "1"], 8_000);
    const wh = out == null ? null : parseTypeperfWh(out);
    return wh == null ? null : { wh, wrapWh: null };
  }
  if (platform === "linux") {
    try {
      const dir = "/sys/class/powercap/intel-rapl:0";
      const uj = Number(fs.readFileSync(path.join(dir, "energy_uj"), "utf8"));
      const max = Number(fs.readFileSync(path.join(dir, "max_energy_range_uj"), "utf8"));
      if (!Number.isFinite(uj)) return null;
      return { wh: uj / 3.6e9, wrapWh: Number.isFinite(max) && max > 0 ? max / 3.6e9 : null };
    } catch {
      // Readable by root only on most kernels since 2020: CPU stays "không đo được".
      return null;
    }
  }
  return null;
}

async function readGpu(run: Exec = exec): Promise<number | null> {
  const out = await run("nvidia-smi", ["--query-gpu=power.draw", "--format=csv,noheader,nounits"]);
  return out == null ? null : parseGpuWatts(out);
}

type State = { ledger: Ledger | null; prev: Reading | null; live: Live | null; unsaved: number; timer: NodeJS.Timeout | null; busy: boolean };
/** On `globalThis`: instrumentation.ts and the route handlers are separate bundles with their own module copies. */
const g = globalThis as unknown as { __hqPower?: State };
const S = (g.__hqPower ??= { ledger: null, prev: null, live: null, unsaved: 0, timer: null, busy: false });

/** The ledger in memory, read once; null while power.json exists but can't be read. */
const loaded = (): Ledger | null => (S.ledger ??= readLedger());

function save(): void {
  if (S.ledger) S.unsaved = writeLedger(S.ledger) ? 0 : SAVE_EVERY;
}

/** The core's sampler reading (PDH + NVML opened once), or null without a core: then typeperf + nvidia-smi. */
async function coreReading(): Promise<Reading | null> {
  const v = (await coreGet("/v1/power"))?.v as Partial<Reading> | undefined;
  if (typeof v?.at !== "number") return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return { at: v.at, cpuWh: n(v.cpuWh), cpuWrapWh: n(v.cpuWrapWh), gpuW: n(v.gpuW) };
}

/** One sample: read, count, save now and then. */
export async function sampleOnce(run: Exec = exec, platform: NodeJS.Platform = process.platform): Promise<void> {
  let cur = await coreReading();
  if (!cur) {
    const [cpu, gpuW] = await Promise.all([readCpu(platform, run), readGpu(run)]);
    cur = { at: Date.now(), cpuWh: cpu?.wh ?? null, cpuWrapWh: cpu?.wrapWh ?? null, gpuW };
  }
  // No await from here to the credit: a settings change can't be overwritten by a stale copy.
  const l = loaded();
  const r = step(S.prev, cur, (l ?? fresh()).settings.otherW);
  S.prev = cur;
  S.live = r.live;
  // power.json exists but is locked: count nothing this time rather than overwrite it.
  if (!l) return;
  const day = dayKey(cur.at);
  if (r.add) {
    S.ledger = credit(l, day, r.add, cur.at);
    S.unsaved += 1;
  }
  if (S.unsaved >= SAVE_EVERY) save();
}

/** Starts the sampler once per process (instrumentation.ts). */
export function startPower(): void {
  if (S.timer) return;
  const tick = async () => {
    if (S.busy) return;
    S.busy = true;
    try {
      await sampleOnce();
    } catch (e) {
      console.error("[hq] power sample failed:", e instanceof Error ? e.message : String(e));
    } finally {
      S.busy = false;
    }
  };
  void tick();
  S.timer = setInterval(() => void tick(), SAMPLE_MS);
  S.timer.unref();
}

/** Null until the sampler has run (tests, or an HQ started without instrumentation), or while power.json is locked. */
export function power(now = Date.now()): Power | null {
  if (!S.timer && !S.ledger) return null;
  const l = loaded();
  return l ? summarize(l, S.live, now) : null;
}

/** Null when power.json is locked right now (the caller answers "try again"). */
export function setPowerSettings(s: PowerSettings, now = Date.now()): Power | null {
  const l = loaded();
  if (!l) return null;
  S.ledger = { ...l, settings: s };
  save();
  if (S.live) S.live = { ...S.live, otherW: s.otherW, w: S.live.w - S.live.otherW + s.otherW };
  return summarize(S.ledger, S.live, now);
}

export const powerSettings = (): PowerSettings => loaded()?.settings ?? DEFAULTS;
