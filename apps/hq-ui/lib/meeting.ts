// Pure model of the daily sprint meeting: `8sync ccc meet --say` appends one row per room to
// su-code/standup/<YYYY-MM-DD>.md; a room whose row is younger than MEETING_MS is "in the meeting"
// (its lead has left the seat). No I/O. Tested in tests/meeting.test.ts.

export const MEETING_MS = 30 * 60_000;
/** The CSS slide itself (hq-walk-out, hq-walk-in). */
export const WALK_MS = 1600;
/**
 * The "out" / "back" phases: a meet row carries HH:MM only, so a phase shorter than a minute could
 * never be seen. The lead walks for WALK_MS and then stands at the door for the rest of the minute.
 */
export const WALK_PHASE_MS = 60_000;

export type Attendee = { room: string; at: number; done: string; doing: string; blocked: string };
export type WalkPhase = "out" | "table" | "back";

const MAX_ROWS = 200;
const MAX_CELL = 160;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Rows of one day's standup file. `date` is the file's UTC date; times are HH:MM UTC. Junk and header lines are skipped. */
export function parseStandupDay(md: string, date: string): Attendee[] {
  if (!DATE.test(date)) return [];
  const out: Attendee[] = [];
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.length < 5) continue;
    const m = HHMM.exec(cells[0]);
    if (!m) continue; // header row, |---| line, anything else
    const at = Date.parse(`${date}T${m[1]}:${m[2]}:00Z`);
    if (!Number.isFinite(at)) continue;
    const room = cells[1].slice(0, MAX_CELL);
    if (!room) continue;
    out.push({
      room,
      at,
      done: cells[2].slice(0, MAX_CELL),
      doing: cells[3].slice(0, MAX_CELL),
      blocked: cells[4].slice(0, MAX_CELL),
    });
    if (out.length >= MAX_ROWS) break;
  }
  return out;
}

/** Rooms that spoke within the last MEETING_MS (a room that spoke twice counts once, its latest row). */
export function attendeesNow(rows: Attendee[], now: number): Attendee[] {
  const latest = new Map<string, Attendee>();
  for (const r of rows) {
    const age = now - r.at;
    if (age < 0 || age >= MEETING_MS) continue;
    const k = r.room.toLowerCase();
    const prev = latest.get(k);
    if (!prev || r.at >= prev.at) latest.set(k, r);
  }
  return [...latest.values()].sort((a, b) => a.at - b.at);
}

/** Where the lead is: walking out (first WALK_MS), at the table, walking back (last WALK_MS), or null once the meeting is over. */
export function walkPhase(at: number, now: number): WalkPhase | null {
  const age = now - at;
  if (age < 0 || age >= MEETING_MS) return null;
  if (age < WALK_PHASE_MS) return "out";
  if (age >= MEETING_MS - WALK_PHASE_MS) return "back";
  return "table";
}

export function meetingLabel(n: number, until: number, now: number): string {
  const min = Math.max(0, Math.ceil((until - now) / 60_000));
  return `Họp sprint · ${n} phòng · ${min > 0 ? `còn ${min} phút` : "sắp xong"}`;
}
