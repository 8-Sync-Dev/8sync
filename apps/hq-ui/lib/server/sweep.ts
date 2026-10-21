// "Dọn máy tự động": HQ keeps one `sweep` room (lib/sweep.ts) in every project whose team runs and
// whose switch is on (no row in hq.db sweep_switch = on). A 60 s loop (instrumentation.ts) runs
// `8sync ccc auto up --add sweep` in a project that lacks it: one pass at a time, one project at a
// time, a failure backs off 5 min doubling to 1 h, a success is not repeated for 10 min. The owner's
// off runs `auto down --only sweep` and is remembered only once that worked. The guard trigger mails
// `[máy] …` to the sweeps of projects whose own rooms carry the load (≤ 1 per 5 min per project).
// Fixed argv only; a root reaches the CLI only as its working directory.
import type { DatabaseSync } from "node:sqlite";
import { diskKey } from "../disk";
import { repoOf } from "../sidebar";
import { ALERT_EVERY_MS, alertText, ENSURE_AGAIN_MS, ENSURE_EVERY_MS, isSweepRoom, loadIsTheirs, nextBackoff, SWEEP_ROOM, sweepArgs } from "../sweep";
import { autoStatus, lastAutoStatus, type AutoStatus } from "./auto";
import { getDb } from "./db";
import { projectOf } from "./office";
import { mergedSessions, run } from "./proc";
import { tail } from "./team";

type Backoff = { until: number; ms: number; error: string };
type Mem = {
  busy: Set<string>;
  backoff: Map<string, Backoff>;
  okAt: Map<string, number>;
  alertAt: Map<string, number>;
  /** Projects (diskKey) with a live sweep room at the last pass. */
  live: Set<string>;
  tick: Promise<string[]> | null;
  timer: NodeJS.Timeout | null;
};
// On globalThis: instrumentation.ts and the routes are separate bundles with their own module copies.
const g = globalThis as unknown as { __hqSweep?: Mem };
const mem = (): Mem => (g.__hqSweep ??= { busy: new Set(), backoff: new Map(), okAt: new Map(), alertAt: new Map(), live: new Set(), tick: null, timer: null });

/** Test seam: forget every in-memory state. */
export function resetSweep() {
  clearInterval(g.__hqSweep?.timer ?? undefined);
  delete g.__hqSweep;
}

/** A team root as a working directory (`8sync` canonicalizes Windows roots to `\\?\C:\…`). */
const cwdOf = (root: string) => root.replace(/^\\\\\?\\/, "");

/** The switch: on unless the owner turned it off for this project. */
export function sweepOn(db: DatabaseSync, root: string): boolean {
  const r = db.prepare("SELECT enabled FROM sweep_switch WHERE key = ?").get(diskKey(root)) as { enabled: number } | undefined;
  return r ? Number(r.enabled) === 1 : true;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 1024) : []);
/** `k` (a diskKey) is folder `dir` or inside it. */
const within = (k: string, dir: string) => k === diskKey(dir) || k.startsWith(`${diskKey(dir)}/`);

/** Roots whose team runs now: auto on, not paused, brought up by `auto up`, in auto's scope (`repos`; none = every project) and not taken out by `auto close` (`out`). */
export function runningTeams(st: AutoStatus | null | undefined): string[] {
  if (!st?.on || st.paused) return [];
  const repos = strings(st.repos);
  const out = strings(st.out);
  return strings(st.team_roots).filter((r) => {
    const k = diskKey(r);
    return (repos.length === 0 || repos.some((x) => within(k, x))) && !out.some((x) => within(k, x));
  });
}

type Sess = { name: string; label?: string | null; cwd: string | null; status: string };

/** Projects (diskKey of the repo, worktrees folded in) with a live sweep room. */
export function liveSweeps(sessions: Sess[]): Set<string> {
  const out = new Set<string>();
  for (const s of sessions) {
    if (s.status === "ended" || !s.cwd || !isSweepRoom(s.label ?? s.name)) continue;
    out.add(diskKey(repoOf(projectOf(s.cwd)?.root ?? s.cwd).root));
  }
  return out;
}

export type SweepDeps = { status: () => Promise<AutoStatus | null>; sessions: () => Promise<Sess[]> };
const realDeps = (db: DatabaseSync): SweepDeps => ({ status: async () => lastAutoStatus() ?? (await autoStatus()), sessions: () => mergedSessions(db) });

const firstLine = (s: string) => tail(s, 4).replace(/^Error:\s*/, "").split(/\r?\n/)[0]?.slice(0, 200) || "8sync ccc auto up --add sweep thất bại";

/**
 * One ensure pass: every running team with the switch on and no live sweep room gets one. Single
 * flight (a pass while one runs returns []), skips projects backing off or added < 10 min ago.
 * Never throws; returns the roots it added the room to.
 */
export async function sweepTick(db: DatabaseSync, now = Date.now(), deps: SweepDeps = realDeps(db)): Promise<string[]> {
  const m = mem();
  if (m.tick) return [];
  const job = (async () => {
    const teams = runningTeams(await deps.status()).filter((r) => sweepOn(db, r));
    if (!teams.length) return [];
    m.live = liveSweeps(await deps.sessions());
    const added: string[] = [];
    for (const root of teams) {
      const k = diskKey(root);
      if (m.live.has(k) || m.busy.has(k)) continue;
      const b = m.backoff.get(k);
      if (b && b.until > now) continue;
      const ok = m.okAt.get(k);
      if (ok != null && now - ok < ENSURE_AGAIN_MS) continue;
      // Re-read: the owner may have turned it off while this pass waited on the room list.
      if (!sweepOn(db, root)) continue;
      m.busy.add(k);
      try {
        const r = await run("8sync", sweepArgs(true), 180_000, cwdOf(root));
        if (r.ok) {
          m.okAt.set(k, now);
          m.backoff.delete(k);
          added.push(root);
        } else {
          const ms = nextBackoff(b?.ms ?? null);
          m.backoff.set(k, { until: now + ms, ms, error: firstLine(`${r.stderr}\n${r.stdout}`) });
        }
      } finally {
        m.busy.delete(k);
      }
    }
    return added;
  })();
  m.tick = job;
  try {
    return await job;
  } catch {
    return [];
  } finally {
    m.tick = null;
  }
}

export type SweepResult = { ok: boolean; on: boolean; output: string; error: string | null };

/**
 * The owner's switch. On: remembered first (the loop then keeps the room), then `auto up --add
 * sweep`. Off: `auto down --only sweep` first and remembered only once it worked, so a failed stop
 * (the revive lock held, `8sync` missing) leaves the switch on with the error shown instead of
 * "tắt" over a room that still runs. The project is busy meanwhile: the loop never adds it then.
 */
export async function setSweep(db: DatabaseSync, root: string, on: boolean, now = Date.now()): Promise<SweepResult> {
  const m = mem();
  const k = diskKey(root);
  if (m.busy.has(k)) return { ok: false, on: sweepOn(db, root), output: "", error: "đang bật/tắt phòng dọn máy, đợi lần trước xong" };
  const remember = () => db.prepare("INSERT INTO sweep_switch(key, root, enabled, at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET root = excluded.root, enabled = excluded.enabled, at = excluded.at").run(k, root, on ? 1 : 0, now);
  if (on) remember();
  m.busy.add(k);
  try {
    const r = await run("8sync", sweepArgs(on), on ? 180_000 : 60_000, cwdOf(root));
    const output = tail(`${r.stdout}\n${r.stderr}`, 8);
    m.backoff.delete(k);
    if (!r.ok) {
      if (on) m.backoff.set(k, { until: now + nextBackoff(null), ms: nextBackoff(null), error: firstLine(`${r.stderr}\n${r.stdout}`) });
      return { ok: false, on: sweepOn(db, root), output, error: tail(r.stderr, 4).replace(/^Error:\s*/, "") || "8sync ccc auto thất bại" };
    }
    if (on) m.okAt.set(k, now);
    else {
      remember();
      m.okAt.delete(k);
    }
    return { ok: true, on, output, error: null };
  } finally {
    m.busy.delete(k);
  }
}

/**
 * The guard trigger fired (`why`, e.g. "CPU 72% ×3"): each running team with the switch on, a live
 * sweep and load of its own in the guard's last pass ([`loadIsTheirs`]) gets one `[máy] …` line
 * with its top CPU eaters, at most once per 5 min per project (a failed send does not count).
 * Never throws; returns the roots messaged.
 */
export async function sweepAlert(db: DatabaseSync, why: string, now = Date.now(), deps: SweepDeps = realDeps(db)): Promise<string[]> {
  const m = mem();
  const sent: string[] = [];
  try {
    const st = await deps.status();
    const guard = (r: string) => st?.guard?.projects.find((p) => diskKey(p.root) === diskKey(r));
    const due = runningTeams(st).filter((r) => {
      const last = m.alertAt.get(diskKey(r));
      return (last == null || now - last >= ALERT_EVERY_MS) && loadIsTheirs(guard(r)) && sweepOn(db, r);
    });
    if (!due.length) return [];
    const live = liveSweeps(await deps.sessions());
    for (const root of due) {
      const k = diskKey(root);
      if (!live.has(k)) continue;
      m.alertAt.set(k, now);
      const r = await run("8sync", ["ccc", "msg", SWEEP_ROOM, alertText(why, guard(root)?.top ?? [])], 30_000, cwdOf(root));
      if (r.ok) sent.push(root);
      else m.alertAt.delete(k);
    }
  } catch {
    /* the next breach tries again */
  }
  return sent;
}

/** What the Máy tab shows per running team: the switch, whether the room was live at the last pass, why adding it failed. */
export type SweepProject = { root: string; name: string; on: boolean; live: boolean; busy: boolean; error: string | null; retryAt: number | null };

/** From the shared auto status and the loop's memory; spawns nothing. */
export function sweepView(db: DatabaseSync, st: AutoStatus | null = lastAutoStatus()): SweepProject[] {
  const m = mem();
  return runningTeams(st).map((root) => {
    const k = diskKey(root);
    const b = m.backoff.get(k);
    const r = repoOf(cwdOf(root));
    return { root, name: r.name, on: sweepOn(db, root), live: m.live.has(k), busy: m.busy.has(k), error: b?.error ?? null, retryAt: b?.until ?? null };
  });
}

/** Starts the 60 s ensure loop once per process (instrumentation.ts). */
export function startSweepLoop(): void {
  const m = mem();
  if (m.timer) return;
  m.timer = setInterval(() => {
    void sweepTick(getDb()).catch((e) => console.error("[hq] sweep ensure failed:", e instanceof Error ? e.message : String(e)));
  }, ENSURE_EVERY_MS);
  m.timer.unref();
}
