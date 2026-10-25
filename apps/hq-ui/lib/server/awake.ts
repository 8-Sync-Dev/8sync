// "Thức & màn hình" in the Máy tab: is the machine held awake, is the screen off, how long since
// anyone touched it, and which rooms kept working since. From `8sync ccc awake status --json`
// (OS truth: execution state, console display state, last input, time asleep) at most every 30 s,
// plus the rooms' idle-hook status files. Older 8sync without `status`: the section is left out.
// The switch reads `ours` (this 8sync's own hold), never `held`: on Windows `held` is the
// system-wide aggregate (omp.exe holds SYSTEM too), so it can't say whether the switch is on.
import { readIdleStatus } from "./idle";
import { coreGet } from "./core";
import { run } from "./proc";
import type { IdleRecord } from "../idle";

const EVERY_MS = 30_000;
/** Shorter than this away is just reading the page: no "trong lúc vắng" line. */
export const AWAY_AFTER_S = 300;

/** This 8sync's detached hold (`8sync ccc awake on`); `until` in unix seconds, 0 = until switched off. */
export type AwakeHold = { pid: number; until: number; while_rooms: boolean };

export type AwakeStatus = {
  held: boolean | null;
  display_required: boolean | null;
  display: "on" | "off" | "dim" | null;
  idle_s: number | null;
  boot_s: number | null;
  slept_s: number | null;
  modern_standby: boolean | null;
  /** null: no hold of ours (or an 8sync too old to say). */
  ours: AwakeHold | null;
};
/**
 * `displayBy`: what keeps the screen on (from `powercfg /requests`, which needs an elevated HQ; null when unknown).
 * `away`: since the last keyboard/mouse input, how many rooms finished a turn and when the newest did.
 */
export type Awake = AwakeStatus & { at: number; displayBy: string[] | null; away: { since: number; rooms: number; last: number | null } | null };

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);
const secs = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

function hold(v: unknown): AwakeHold | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const pid = secs(o.pid);
  const until = secs(o.until);
  return pid && until != null ? { pid, until, while_rooms: o.while_rooms === true } : null;
}

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
      ours: hold(v.ours),
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
/**
 * On globalThis: `/api/machine` (reads) and `/api/machine/awake` (flips) may be separate bundles
 * with their own module copies, and a flip must reach the reader's cache. `gen` grows on each flip,
 * so a probe that started before it never lands as the fresh state.
 */
type State = { cache: Probe | null; inflight: Promise<Probe> | null; gen: number; switching: boolean };
const G = globalThis as unknown as { __hqAwake?: State };
const S = (G.__hqAwake ??= { cache: null, inflight: null, gen: 0, switching: false });

async function probe(now: number): Promise<Probe> {
  // The core answers in process (same JSON as `8sync ccc awake status --json`); else one process.
  const viaCore = await coreGet("/v1/awake");
  let v: AwakeStatus | null;
  if (viaCore) v = parseAwake(JSON.stringify(viaCore.v));
  else {
    const r = await run("8sync", ["ccc", "awake", "status", "--json"], 5_000);
    v = r.ok ? parseAwake(r.stdout) : null;
  }
  let displayBy: string[] | null = null;
  if (v?.display_required && process.platform === "win32") {
    const p = await run("powercfg", ["/requests"], 5_000);
    displayBy = p.ok ? parseDisplayHolders(p.stdout) : null;
  }
  return { at: now, v, displayBy };
}

export async function awake(now = Date.now()): Promise<Awake | null> {
  let c = S.cache;
  if (!c || now - c.at >= EVERY_MS) {
    // One probe however many tabs poll at once.
    const gen = S.gen;
    S.inflight ??= probe(now).finally(() => (S.inflight = null));
    c = await S.inflight;
    if (gen === S.gen) S.cache = c;
  }
  const { v, displayBy } = c;
  if (!v) return null;
  // idle_s was true at probe time; it has grown since unless someone came back (next probe).
  const idle = v.idle_s == null ? null : v.idle_s + Math.floor(Math.max(0, now - c.at) / 1000);
  return { ...v, idle_s: idle, at: now, displayBy: displayBy?.length ? displayBy : null, away: awayFrom(idle, readIdleStatus(), now) };
}

/** `on` waits up to 20 s for the detached hold to report in (it asks `claude agents` first). */
const SWITCH_TIMEOUT_MS = 30_000;

/**
 * The Máy tab switch: `8sync ccc awake on|off`. `on` starts `8sync awake` detached, held until `off`
 * (outside HQ, so it survives an HQ restart) and returns; `off` stops only that hold.
 * `message`: 8sync's own line (success or why not), shown in the toast. One flip at a time (two
 * tabs, a double tap): a second request while one runs is refused (`busy`), never queued.
 */
export async function setAwake(on: boolean): Promise<{ ok: boolean; busy?: boolean; message: string }> {
  if (S.switching) return { ok: false, busy: true, message: "Đang đổi giữ máy thức, thử lại sau vài giây" };
  S.switching = true;
  try {
    const r = await run("8sync", ["ccc", "awake", on ? "on" : "off"], SWITCH_TIMEOUT_MS);
    // The next poll probes again and shows the new `ours`.
    S.gen += 1;
    S.cache = null;
    const line = (s: string) => s.trim().replace(/^Error:\s*/, "").split(/\r?\n/)[0]?.slice(0, 300) ?? "";
    if (r.ok) return { ok: true, message: line(r.stdout) || (on ? "Đã bật giữ máy thức" : "Đã tắt giữ máy thức") };
    return { ok: false, message: line(r.stderr) || line(r.stdout) || `8sync ccc awake ${on ? "on" : "off"} không chạy được` };
  } finally {
    S.switching = false;
  }
}
