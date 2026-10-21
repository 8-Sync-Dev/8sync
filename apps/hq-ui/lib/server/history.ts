// "Tải máy" history: one RAM / CPU / watts sample every HISTORY_EVERY_MS kept for HISTORY_KEEP samples
// (30 min), taken by a server loop so the chart is full whether or not a tab was open (owner
// 2026-10-21: "chưa có đồ thị"). Pure ring-buffer rules here; the loop and the probes at the bottom.
import { machine } from "./machine";
import { power } from "./power";

export const HISTORY_EVERY_MS = 30_000;
export const HISTORY_KEEP = 60;

/** `w`: watts from the power sampler, null before its first reading or without a counter. */
export type Sample = { at: number; ram: number; cpu: number | null; w: number | null };

/** `samples` plus `s`, oldest dropped past `keep`; a sample inside half a period of the last replaces it (two loops, a poll and the timer, never double up). */
export function push(samples: readonly Sample[], s: Sample, keep = HISTORY_KEEP, every = HISTORY_EVERY_MS): Sample[] {
  const last = samples[samples.length - 1];
  const base = last && s.at - last.at < every / 2 ? samples.slice(0, -1) : samples.slice();
  base.push(s);
  return base.length > keep ? base.slice(base.length - keep) : base;
}

/** Samples of the last `windowMs` before `now`, oldest first (a gap while the machine slept just shows as a gap). */
export function recent(samples: readonly Sample[], now: number, windowMs = HISTORY_KEEP * HISTORY_EVERY_MS): Sample[] {
  return samples.filter((s) => now - s.at <= windowMs && s.at <= now);
}

type State = { samples: Sample[]; timer: NodeJS.Timeout | null; busy: boolean };
/** On `globalThis`: instrumentation.ts and the route handlers are separate bundles with their own module copies. */
const g = globalThis as unknown as { __hqHistory?: State };
const S = (g.__hqHistory ??= { samples: [], timer: null, busy: false });

/** One sample now: RAM and CPU from the machine probe (no process list), watts from the power sampler. */
export async function sampleOnce(now = Date.now()): Promise<void> {
  if (S.busy) return;
  S.busy = true;
  try {
    const m = await machine(process.platform, undefined, false);
    const ram = m.mem.totalMb > 0 ? Math.round((100 * m.mem.usedMb) / m.mem.totalMb) : 0;
    S.samples = push(S.samples, { at: now, ram, cpu: m.cpu.pct, w: power(now)?.live?.w ?? null });
  } catch {
    /* a failed probe is just a missing sample */
  } finally {
    S.busy = false;
  }
}

/** Server start (instrumentation.ts): sample now, then every HISTORY_EVERY_MS. */
export function startHistory(): void {
  if (S.timer) return;
  void sampleOnce();
  S.timer = setInterval(() => void sampleOnce(), HISTORY_EVERY_MS);
  S.timer.unref?.();
}

/** What the Máy tab charts: the last 30 minutes, oldest first. */
export function history(now = Date.now()): Sample[] {
  return recent(S.samples, now);
}
