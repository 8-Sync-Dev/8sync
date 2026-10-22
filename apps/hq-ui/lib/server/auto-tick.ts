// Server side of "Chạy liên tục": [startAutoTickLoop] runs it every TICK_LOOP_MS from server start, and
// GET /api/auto runs it too (its answer shows the tab what was ticked). Before v0.110.29 only the Office
// tab's 60 s poll ran it, and STALE_MS forgot every idle time 3 min after the last poll: with no HQ tab
// open nothing was woken or revived (owner 2026-10-21: "tự lên task chậm").
import fs from "node:fs";
import path from "node:path";
import { focusRests, inAutoScope } from "../auto";
import { pruneTicked, STALE_MS, TICK_PROMPT, tickTargets, type TickRoom } from "../auto-tick";
import { repoOf } from "../sidebar";
import type { AutoStatus } from "./auto";
import { getDb } from "./db";
import { isSessionId, queueInbox } from "./inbox";
import { loadOffice } from "./office";
import { stateDir } from "./paths";
import { run } from "./proc";
import { readIdleStatus } from "./idle";
import { autoStatus } from "./auto";
import { eyeAutoTick } from "./eye";
import { sweepStuckAsks } from "./stuck-asks";
import { teamOf } from "../idle";

/** `revived`: when HQ last asked 8sync to bring back team rooms that died (machine restart). */
type State = { schema: 1; at: number; ticked: Record<string, number>; idle: Record<string, number>; revived: number };

/** At most one `8sync ccc auto revive` per this long, however many tabs poll. */
export const REVIVE_MS = 60_000;

/**
 * A `no_tick: "cron"` record older than this is ignored: a session with its own loop rewrites it at
 * every turn end, and the backup cron fires every 30 min, so one older than that period + 5 min means
 * the loop is gone (deleted, or the session died) and HQ must wake the session again. `"events"`
 * (a room without a board lane) holds until `8sync ccc auto on|pause|off` clears it.
 */
export const NO_TICK_MS = 35 * 60_000;

const stateFile = () => path.join(stateDir(), "auto-tick.json");

function numMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") {
    for (const [k, t] of Object.entries(v)) if (isSessionId(k) && typeof t === "number" && Number.isFinite(t)) out[k] = t;
  }
  return out;
}

/** `idle` only counts while polls keep coming: after a gap (tab closed, pause) it starts over. */
function readState(now: number): State {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const at = typeof j?.at === "number" && Number.isFinite(j.at) ? j.at : 0;
    const stale = now - at > STALE_MS;
    const revived = typeof j?.revived === "number" && Number.isFinite(j.revived) ? j.revived : 0;
    return { schema: 1, at, ticked: numMap(j?.ticked), idle: stale ? {} : numMap(j?.idle), revived };
  } catch {
    return { schema: 1, at: 0, ticked: {}, idle: {}, revived: 0 };
  }
}

/** Write-then-rename: a crash mid-write must not reset the 10-minute memory. */
function writeState(s: State): void {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * Queue one TICK_PROMPT per idle session. Neither Room nor SessionView carries an updated_at, so
 * idleSince is the first poll that saw the session idle (state.idle); a session that is busy again
 * loses its entry. The first sighting therefore never ticks: the next 60 s poll can.
 */
type TickResult = { ticked: string[]; error?: string };
const g = globalThis as { __hqAutoTick?: { flight: Promise<TickResult> | null; timer: NodeJS.Timeout | null } };
const mem = () => (g.__hqAutoTick ??= { flight: null, timer: null });

/** One tick at a time: the loop and a tab's poll landing together must not queue two prompts; the later caller waits and reports nothing new. */
export function runAutoTick(status: AutoStatus, now = Date.now()): Promise<TickResult> {
  const m = mem();
  if (m.flight) return m.flight.then((r) => ({ ticked: [], ...(r.error ? { error: r.error } : {}) }));
  m.flight = tickOnce(status, now).finally(() => {
    m.flight = null;
  });
  return m.flight;
}

/** Every tab-independent minute: wake idle rooms, revive dead ones, close stuck asks, "Tự soi ảnh". */
export const TICK_LOOP_MS = 60_000;
export function startAutoTickLoop(): void {
  const m = mem();
  if (m.timer) return;
  m.timer = setInterval(() => {
    void autoStatus()
      .then(async (status) => {
        await runAutoTick(status);
        void sweepStuckAsks(status);
        void eyeAutoTick(getDb());
      })
      .catch((e) => console.error("[hq] auto tick loop failed:", e instanceof Error ? e.message : String(e)));
  }, TICK_LOOP_MS);
  m.timer.unref();
}

/** Test seam. */
export function stopAutoTickLoop(): void {
  const m = mem();
  if (m.timer) clearInterval(m.timer);
  m.timer = null;
  m.flight = null;
}

async function tickOnce(status: AutoStatus, now: number): Promise<TickResult> {
  // Off, paused, or the lease gate is holding (expired / over budget / owner away): never wake anyone.
  // With "Lease liên tục" on, `8sync ccc auto revive` still runs while gated: its lease tick renews on
  // the owner's presence, and it wakes the rooms by itself once the usage window drops.
  if (!status.on || status.paused || (status.gate && !status.lease_auto)) return { ticked: [] };
  try {
    // Read after the office load (concurrent polls must see each other's state, never an older one).
    const office = status.gate ? null : await loadOffice(getDb(), now);
    const state = readState(now);
    // Rooms whose background session died with the machine: 8sync resumes them inside the same
    // rails (on, not paused, in scope, lease/usage gate). Fixed argv; not awaited (resumes take seconds).
    let revived = state.revived;
    if (now - revived >= REVIVE_MS) {
      revived = now;
      void run("8sync", ["ccc", "auto", "revive"], REVIVE_MS);
      // Headless Chromium left by an `8sync shot` whose 8sync died mid-render (a guard pause
      // kills the room's shell tree; Chromium's children survive and burn GPU for hours —
      // 2026-10-22, 47% GPU). One sweep per revive minute; live shots are younger than that.
      void run(
        "powershell",
        ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*8sync-shot-*' -and $_.CreationDate -lt (Get-Date).AddMinutes(-10) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`],
        REVIVE_MS,
      ).catch(() => {});
    }
    if (!office) {
      writeState({ ...state, at: now, revived });
      return { ticked: [] };
    }
    const idle: Record<string, number> = {};
    // Sessions whose own Stop hook says "my cron loop ticks me" or "no board lane: messages only",
    // while that word is recent (NO_TICK_MS). `8sync ccc auto on|pause|off` also clears the flags.
    const quiet = new Set(readIdleStatus().filter((r) => r.noTick === "events" || (r.noTick === "cron" && now - r.ts * 1000 <= NO_TICK_MS)).map((r) => r.team));
    // Only projects auto drives (`repos` minus `out`); with usage tight and projects pinned, the
    // other projects' rooms rest too (8sync `focus_rest`).
    const roomRepo = (r: { project?: { root: string } | null; cwd?: string | null }) => repoOf(r.project?.root ?? r.cwd ?? "").root;
    const rooms: TickRoom[] = office.rooms.filter((r) => inAutoScope(status, roomRepo(r)) && !focusRests(status, roomRepo(r))).map((r) => {
      const sid = r.session_id;
      const isIdle = r.status === "idle";
      if (sid && isIdle) idle[sid] = state.idle[sid] ?? now;
      const team = teamOf(sid);
      return { session_id: sid, status: r.status, inboxLive: r.inboxLive, pending: r.pending, idleSince: sid && isIdle ? idle[sid] : now, noTick: !!team && quiet.has(team) };
    });
    const ticked = pruneTicked(state.ticked, now);
    const targets = tickTargets(rooms, ticked, now).filter(isSessionId);
    for (const sid of targets) {
      queueInbox(sid, TICK_PROMPT, now);
      ticked[sid] = now;
    }
    writeState({ schema: 1, at: now, ticked, idle, revived });
    return { ticked: targets };
  } catch (e) {
    // Detail (may hold paths) stays in the server log; the page only learns that the tick failed.
    console.error("auto-tick:", e instanceof Error ? e.message : String(e));
    return { ticked: [], error: "tick failed" };
  }
}
