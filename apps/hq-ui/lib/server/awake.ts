// "Thức & màn hình" in the Máy chip: is the machine held awake, is the screen off, how long since
// anyone touched it, and which rooms kept working since. From `8sync ccc awake status --json`
// (OS truth: execution state, console display state, last input, time asleep) at most every 30 s,
// plus the rooms' idle-hook status files. Older 8sync without `status`: the section is left out.
import { readIdleStatus } from "./idle";
import { run } from "./proc";
import type { IdleRecord } from "../idle";

const EVERY_MS = 30_000;
/** Shorter than this away is just reading the page: no "trong lúc vắng" line. */
export const AWAY_AFTER_S = 300;

export type AwakeStatus = {
  held: boolean | null;
  display_required: boolean | null;
  display: "on" | "off" | "dim" | null;
  idle_s: number | null;
  boot_s: number | null;
  slept_s: number | null;
  modern_standby: boolean | null;
};
/**
 * `displayBy`: what keeps the screen on (from `powercfg /requests`, which needs an elevated HQ; null when unknown).
 * `away`: since the last keyboard/mouse input, how many rooms finished a turn and when the newest did.
 */
export type Awake = AwakeStatus & { at: number; displayBy: string[] | null; away: { since: number; rooms: number; last: number | null } | null };

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const secs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

export function parseAwake(stdout: string): AwakeStatus | null {
  try {
    const v = JSON.parse(stdout);
    if (!v || typeof v !== "object" || v.schema !== 1) return null;
    return {
      held: bool(v.held),
      display_required: bool(v.display_required),
      display: v.display === "on" || v.display === "off" || v.display === "dim" ? v.display : null,
      idle_s: secs(v.idle_s),
      boot_s: secs(v.boot_s),
      slept_s: secs(v.slept_s),
      modern_standby: bool(v.modern_standby),
    };
  } catch {
    return null;
  }
}

/** Rooms whose last hook fired after the owner's last input (record `ts` is in seconds). */
export function awayFrom(idleS: number | null, records: IdleRecord[], now: number): Awake["away"] {
  if (idleS == null || idleS < AWAY_AFTER_S) return null;
  const since = now - idleS * 1000;
  const after = records.filter((r) => r.ts * 1000 >= since);
  return { since, rooms: after.length, last: after.length ? Math.max(...after.map((r) => r.ts * 1000)) : null };
}

/** `powercfg /requests`, DISPLAY section: "Godot_v4.7.2-stable_win64.exe", driver names; [] for "None.". */
export function parseDisplayHolders(out: string): string[] {
  const lines = out.split(/\r?\n/).map((l) => l.trim());
  const start = lines.indexOf("DISPLAY:");
  if (start < 0) return [];
  const names: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^[A-Z]+:$/.test(l)) break;
    const m = /^\[(?:PROCESS|DRIVER|SERVICE)\]\s+(.+)$/.exec(l);
    if (m) names.push(m[1].replace(/^.*[\\/]/, "").replace(/\s*\(.*\)$/, "").slice(0, 80));
  }
  return [...new Set(names)].slice(0, 4);
}

type Probe = { at: number; v: AwakeStatus | null; displayBy: string[] | null };
let cache: Probe | null = null;
let inflight: Promise<Probe> | null = null;

async function probe(now: number): Promise<Probe> {
  const r = await run("8sync", ["ccc", "awake", "status", "--json"], 5_000);
  const v = r.ok ? parseAwake(r.stdout) : null;
  let displayBy: string[] | null = null;
  if (v?.display_required && process.platform === "win32") {
    const p = await run("powercfg", ["/requests"], 5_000);
    displayBy = p.ok ? parseDisplayHolders(p.stdout) : null;
  }
  return { at: now, v, displayBy };
}

export async function awake(now = Date.now()): Promise<Awake | null> {
  if (!cache || now - cache.at >= EVERY_MS) {
    // One probe however many tabs poll at once.
    inflight ??= probe(now).finally(() => (inflight = null));
    cache = await inflight;
  }
  const { v, displayBy } = cache;
  if (!v) return null;
  // idle_s was true at probe time; it has grown since unless someone came back (next probe).
  const idle = v.idle_s == null ? null : v.idle_s + Math.floor(Math.max(0, now - cache.at) / 1000);
  return { ...v, idle_s: idle, at: now, displayBy: displayBy?.length ? displayBy : null, away: awayFrom(idle, readIdleStatus(), now) };
}
