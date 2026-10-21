// Fast trigger for the ccc auto resource guard: the guard's own tick is slow, so HQ samples the
// machine every 5 s (server side, no tab needed) and runs `8sync ccc auto guard now --json` as soon
// as a breach holds: CPU ≥ pct for 3 samples, RAM ≥ pct for 2, or VRAM ≥ 90 % for 2. Only while auto
// runs and the guard is on. One run at a time, at least 20 s between starts; the streaks restart
// after each run. A run that changed nothing (or yielded to a revive, or printed junk) doubles the
// gap up to 5 min; a run that acted, or a sample with nothing over, puts it back to 20 s.
// Started once per process from instrumentation.ts.
import { autoStatus, lastAutoStatus } from "./auto";
import type { Guard } from "./guard";
import { machine, type Machine } from "./machine";
import { run } from "./proc";

export const SAMPLE_MS = 5_000;
export const MIN_GAP_MS = 20_000;
export const MAX_GAP_MS = 300_000;
const RUN_TIMEOUT_MS = 60_000;
/** The auto status (on / paused / guard pct) is re-read at least this often without a tab polling it. */
const STATUS_EVERY_MS = 60_000;
const CPU_SAMPLES = 3;
const RAM_SAMPLES = 2;
const VRAM_SAMPLES = 2;
const VRAM_PCT = 90;

/** One sample: CPU, RAM and the fullest GPU's VRAM, % (null = not measured). */
export type Load = { cpu: number | null; ram: number | null; vram: number | null };
/** `at` unix s (like the guard's own times); `why` e.g. "CPU 97% ×3" or "revive đang chạy"; `acted`: the pass changed something. */
export type GuardRun = { at: number; ok: boolean; why: string; acted: boolean };
/**
 * What /api/machine shows: the parsed guard plus this trigger's state (`runningWhy`: why the running
 * pass started; `nextGapS`: the current minimum gap between runs, above 20 while backing off).
 */
export type GuardView = Guard & { running: boolean; runningWhy: string | null; lastRun: GuardRun | null; nextGapS: number };

export type Trigger = { cpu: number; ram: number; vram: number; running: string | null; startedAt: number; gapMs: number; lastRun: GuardRun | null };
export const newTrigger = (): Trigger => ({ cpu: 0, ram: 0, vram: 0, running: null, startedAt: -Infinity, gapMs: MIN_GAP_MS, lastRun: null });

/** One `guard now` pass; `skipped`: a revive held the lock and the pass yielded. */
export type GuardNowResult = { ok: boolean; acted: boolean; skipped: boolean };
/** Ran by the trigger; tests pass a fake so the real `guard now` never runs. */
export type GuardNow = () => Promise<GuardNowResult>;

/** `guard now --json` output → result; a failed run or anything but the contract object = not acted. */
export function parseGuardNow(r: { ok: boolean; stdout: string }): GuardNowResult {
  if (!r.ok) return { ok: false, acted: false, skipped: false };
  try {
    const v = JSON.parse(r.stdout);
    if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.acted !== "boolean") return { ok: false, acted: false, skipped: false };
    const skipped = v.skipped === "revive";
    return { ok: true, acted: v.acted && !skipped, skipped };
  } catch {
    return { ok: false, acted: false, skipped: false };
  }
}

/**
 * One sample: count the streaks; when one is long enough, nothing runs and the last start is at least
 * the current gap ago, start `now()` and return its promise (streaks restart). Else null. Synchronous
 * up to the start, so two samples can never both start a run.
 */
export function step(t: Trigger, l: Load, pct: number, nowMs: number, now: GuardNow): Promise<void> | null {
  t.cpu = l.cpu != null && l.cpu >= pct ? t.cpu + 1 : 0;
  t.ram = l.ram != null && l.ram >= pct ? t.ram + 1 : 0;
  t.vram = l.vram != null && l.vram >= VRAM_PCT ? t.vram + 1 : 0;
  // The breach cleared: the next one starts from the short gap.
  if (t.cpu + t.ram + t.vram === 0) t.gapMs = MIN_GAP_MS;
  const why =
    t.cpu >= CPU_SAMPLES
      ? `CPU ${Math.round(l.cpu!)}% ×${t.cpu}`
      : t.ram >= RAM_SAMPLES
        ? `RAM ${Math.round(l.ram!)}% ×${t.ram}`
        : t.vram >= VRAM_SAMPLES
          ? `VRAM ${Math.round(l.vram!)}% ×${t.vram}`
          : null;
  if (!why || t.running || nowMs - t.startedAt < t.gapMs) return null;
  t.cpu = t.ram = t.vram = 0;
  t.running = why;
  t.startedAt = nowMs;
  return now()
    .catch((): GuardNowResult => ({ ok: false, acted: false, skipped: false }))
    .then((r) => {
      t.gapMs = r.acted ? MIN_GAP_MS : Math.min(t.gapMs * 2, MAX_GAP_MS);
      t.lastRun = { at: Math.floor(nowMs / 1000), ok: r.ok, why: r.skipped ? "revive đang chạy" : why, acted: r.acted };
      t.running = null;
    });
}

export function loadOf(m: Machine): Load {
  const vram = m.gpus?.length ? Math.max(...m.gpus.map((g) => (g.memTotal > 0 ? (100 * g.memUsed) / g.memTotal : 0))) : null;
  return { cpu: m.cpu.pct, ram: m.mem.totalMb > 0 ? (100 * m.mem.usedMb) / m.mem.totalMb : null, vram };
}

type State = { t: Trigger; timer: NodeJS.Timeout | null; busy: boolean; statusAt: number };
/** On `globalThis`: instrumentation.ts and /api/machine are separate bundles with their own module copies. */
const g = globalThis as unknown as { __hqGuardTrigger?: State };
const S = (g.__hqGuardTrigger ??= { t: newTrigger(), timer: null, busy: false, statusAt: 0 });

const realNow: GuardNow = async () => {
  const r = await run("8sync", ["ccc", "auto", "guard", "now", "--json"], RUN_TIMEOUT_MS);
  if (!r.ok) console.error(`[hq] guard now failed: ${(r.stderr.trim() || r.stdout.trim()).split(/\r?\n/)[0]?.slice(0, 200)}`);
  // The card shows the guard's fresh state (level, last action) on the next poll.
  await autoStatus();
  S.statusAt = Date.now();
  return parseGuardNow(r);
};

async function sampleOnce(): Promise<void> {
  const at = Date.now();
  if (at - S.statusAt >= STATUS_EVERY_MS) {
    S.statusAt = at;
    await autoStatus();
  }
  const st = lastAutoStatus();
  const pct = st?.guard?.pct;
  if (!st?.on || st.paused || pct == null) {
    S.t.cpu = S.t.ram = S.t.vram = 0;
    return;
  }
  void step(S.t, loadOf(await machine(process.platform, undefined, false)), pct, Date.now(), realNow);
}

/** Starts the 5 s loop once per process (instrumentation.ts). */
export function startGuardTrigger(): void {
  if (S.timer) return;
  S.timer = setInterval(() => {
    if (S.busy) return;
    S.busy = true;
    sampleOnce()
      .catch((e) => console.error("[hq] guard trigger sample failed:", e instanceof Error ? e.message : String(e)))
      .finally(() => (S.busy = false));
  }, SAMPLE_MS);
  S.timer.unref();
}

/** The guard for /api/machine: null on an 8sync without it. */
export function guardView(guard: Guard | null | undefined): GuardView | null {
  return guard ? { ...guard, running: S.t.running != null, runningWhy: S.t.running, lastRun: S.t.lastRun, nextGapS: Math.round(S.t.gapMs / 1000) } : null;
}
