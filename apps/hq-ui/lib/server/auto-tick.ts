// Server side of "Chạy liên tục": called from GET /api/auto (the Office tab polls it every 60 s).
import fs from "node:fs";
import path from "node:path";
import { pruneTicked, STALE_MS, TICK_PROMPT, tickTargets, type TickRoom } from "../auto-tick";
import type { AutoStatus } from "./auto";
import { getDb } from "./db";
import { isSessionId, queueInbox } from "./inbox";
import { loadOffice } from "./office";
import { stateDir } from "./paths";

type State = { schema: 1; at: number; ticked: Record<string, number>; idle: Record<string, number> };

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
    return { schema: 1, at, ticked: numMap(j?.ticked), idle: stale ? {} : numMap(j?.idle) };
  } catch {
    return { schema: 1, at: 0, ticked: {}, idle: {} };
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
export async function runAutoTick(status: AutoStatus, now = Date.now()): Promise<{ ticked: string[]; error?: string }> {
  // Off, paused, or the lease gate is holding (expired / over budget / owner away): never wake anyone.
  if (!status.on || status.paused || status.gate) return { ticked: [] };
  try {
    const office = await loadOffice(getDb(), now);
    const state = readState(now);
    const idle: Record<string, number> = {};
    const rooms: TickRoom[] = office.rooms.map((r) => {
      const sid = r.session_id;
      const isIdle = r.status === "idle";
      if (sid && isIdle) idle[sid] = state.idle[sid] ?? now;
      return { session_id: sid, status: r.status, inboxLive: r.inboxLive, pending: r.pending, idleSince: sid && isIdle ? idle[sid] : now };
    });
    const ticked = pruneTicked(state.ticked, now);
    const targets = tickTargets(rooms, ticked, now).filter(isSessionId);
    for (const sid of targets) {
      queueInbox(sid, TICK_PROMPT, now);
      ticked[sid] = now;
    }
    writeState({ schema: 1, at: now, ticked, idle });
    return { ticked: targets };
  } catch (e) {
    // Detail (may hold paths) stays in the server log; the page only learns that the tick failed.
    console.error("auto-tick:", e instanceof Error ? e.message : String(e));
    return { ticked: [], error: "tick failed" };
  }
}
