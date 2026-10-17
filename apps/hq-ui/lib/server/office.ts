// The office: every live Claude Code session is a room, grouped by its project (git root of
// the session's cwd) and branch, with its specialists (SubagentStart/Stop), usage (the numbers
// Claude Code gives the 8sync status line: crates/cli/src/verbs/ccc/report.rs), tasks, and the
// walks between rooms (SendMessage between sessions). No model calls, no network.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Ask } from "../ask";
import { teamOf, type IdleRecord } from "../idle";
import { deliveryOf, sessionLabel } from "../labels";
import { costPerTask, roomFor, seatsFor, visitsFrom, type AgentRow, type ProjectInfo, type RoomRef, type Seat, type Usage, type Visit } from "../office";
import { attendeesNow, MEETING_MS, parseStandupDay, walkPhase, type Attendee, type WalkPhase } from "../meeting";
import { readAsk } from "./ask";
import { loadFloor } from "./floor";
import { readIdleStatus } from "./idle";
import { inboxLive, pendingInbox } from "./inbox";
import { stateDir } from "./paths";
import { mergedSessions, type SessionView } from "./proc";

const projectCache = new Map<string, { at: number; v: ProjectInfo | null }>();

/** Git root + branch from the filesystem only (no `git` spawn): `.git` dir, or a worktree `.git` file. */
export function projectOf(cwd: string | null | undefined, now = Date.now()): ProjectInfo | null {
  if (!cwd) return null;
  const hit = projectCache.get(cwd);
  if (hit && now - hit.at < 15_000) return hit.v;
  let v: ProjectInfo | null = null;
  let dir = path.resolve(cwd);
  for (let i = 0; i < 40; i++) {
    const dotgit = path.join(dir, ".git");
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(dotgit);
    } catch {
      /* keep walking up */
    }
    if (st) {
      let gitDir = dotgit;
      if (st.isFile()) {
        const m = /^gitdir:\s*(.+)$/m.exec(readSafe(dotgit) ?? "");
        gitDir = m ? path.resolve(dir, m[1].trim()) : dotgit;
      }
      const head = (readSafe(path.join(gitDir, "HEAD")) ?? "").trim();
      const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
      const branch = ref ? ref[1] : /^[0-9a-f]{7,40}$/i.test(head) ? head.slice(0, 7) : null;
      v = { root: dir, name: path.basename(dir) || dir, branch };
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  projectCache.set(cwd, { at: now, v });
  return v;
}

function readSafe(f: string): string | null {
  try {
    return fs.readFileSync(f, "utf8").slice(0, 4096);
  } catch {
    return null;
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function readUsage(sessionId: string | null | undefined): Usage | null {
  if (!sessionId || !SAFE_ID.test(sessionId)) return null;
  const t = readSafe(path.join(stateDir(), "usage", `${sessionId}.json`));
  if (!t) return null;
  try {
    const v = JSON.parse(t);
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return {
      cost_usd: n(v.cost_usd),
      duration_ms: n(v.duration_ms),
      lines_added: n(v.lines_added),
      lines_removed: n(v.lines_removed),
      context_pct: n(v.context_pct),
      model: typeof v.model === "string" ? v.model : null,
    };
  } catch {
    return null;
  }
}

export type Room = {
  key: string;
  /** What the composer / API addresses: hq-* name or the Claude session id. */
  name: string;
  session_id: string | null;
  label: string;
  status: SessionView["status"];
  waiting: string | null;
  /** What it asks the owner (its transcript's open AskUserQuestion / permission prompt), only while waiting. */
  ask: Ask | null;
  cwd: string | null;
  project: ProjectInfo | null;
  delivery: "terminal" | "inbox" | null;
  pending: number;
  /** Inbox rooms: the 8sync-inbox mod is polling, so pending work enters as soon as the room is idle. */
  inboxLive: boolean;
  /** One line: what the session is doing (from `8sync ls`). */
  doing: string | null;
  state: string | null;
  /** Last transcript activity (unix ms) from `8sync ls`; null when unknown (never the start time). */
  last_active: number | null;
  tokens: number | null;
  model: string | null;
  usage: Usage | null;
  tasks: { done: number; open: number };
  cost_per_task: number | null;
  seats: Seat[];
  role: string | null;
  /** Agent-team name of this session as lead ("session-" + 8 id chars): joins `Office.idle`. */
  team: string | null;
  /** The sprint meeting this room's lead is at (`su-code/standup/<today>.md` row < 30 min old), else null. */
  meeting: { at: number; phase: WalkPhase } | null;
};

export type Meeting = { project: string; root: string; date: string; attendees: Attendee[]; until: number };

const MAX_STANDUP_BYTES = 64 * 1024;

/** Today's standup rows of one project root; only `su-code/standup/<UTC date>.md`, ≤ 64 KB, never throws. */
export function readStandup(root: string, now: number): { date: string; rows: Attendee[] } {
  const date = new Date(now).toISOString().slice(0, 10);
  try {
    const file = path.join(root, "su-code", "standup", `${date}.md`);
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX_STANDUP_BYTES) return { date, rows: [] };
    return { date, rows: parseStandupDay(fs.readFileSync(file, "utf8"), date) };
  } catch {
    return { date, rows: [] };
  }
}

/** Meetings in progress per project root; stamps `room.meeting` on every room whose label / name / session id an attendee names. */
export function loadMeetings(rooms: Room[], now: number): Meeting[] {
  const byRoot = new Map<string, { project: ProjectInfo; rooms: Room[] }>();
  for (const r of rooms) if (r.project) (byRoot.get(r.project.root) ?? byRoot.set(r.project.root, { project: r.project, rooms: [] }).get(r.project.root)!).rooms.push(r);
  const out: Meeting[] = [];
  for (const { project, rooms: rs } of byRoot.values()) {
    const { date, rows } = readStandup(project.root, now);
    const attendees = attendeesNow(rows, now);
    if (!attendees.length) continue;
    const refs: RoomRef[] = rs.map((r) => ({ key: r.key, ids: [r.name, r.session_id ?? "", r.label].filter(Boolean) }));
    for (const a of attendees) {
      const key = roomFor(a.room, refs);
      const room = rs.find((r) => r.key === key);
      const phase = walkPhase(a.at, now);
      if (room && phase && (!room.meeting || a.at >= room.meeting.at)) room.meeting = { at: a.at, phase };
    }
    out.push({ project: project.name, root: project.root, date, attendees, until: Math.max(...attendees.map((a) => a.at)) + MEETING_MS });
  }
  return out;
}

export type LoopInfo = { project: string; slug: string; iter: number; max_iter: number | null; started: number | null; stopped: string | null };

/** `/ship-loop` state per project (`su-code/ship/<slug>/loop.json`, same as `8sync ccc . report`). */
export function readLoops(roots: { root: string; name: string }[]): LoopInfo[] {
  const out: LoopInfo[] = [];
  for (const p of roots) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(path.join(p.root, "su-code", "ship"));
    } catch {
      continue;
    }
    for (const d of dirs.slice(0, 200)) {
      const t = readSafe(path.join(p.root, "su-code", "ship", d, "loop.json"));
      if (!t) continue;
      try {
        const v = JSON.parse(t);
        if (typeof v.slug !== "string" || typeof v.iter !== "number") continue;
        out.push({
          project: p.name,
          slug: v.slug,
          iter: v.iter,
          max_iter: typeof v.max_iter === "number" ? v.max_iter : null,
          started: typeof v.started === "number" ? v.started : null,
          stopped: typeof v.stopped === "string" ? v.stopped.slice(0, 200) : null,
        });
      } catch {
        /* not a loop file */
      }
    }
  }
  return out.sort((a, b) => (b.started ?? 0) - (a.started ?? 0)).slice(0, 30);
}

/** `idle`: every agent-team member's "không ai rảnh" status (lib/idle.ts), stale ones included. */
export type Office = { rooms: Room[]; visits: Visit[]; loops: LoopInfo[]; idle: IdleRecord[]; meetings: Meeting[]; at: number };

export async function loadOffice(db: DatabaseSync, now = Date.now()): Promise<Office> {
  const [merged, floor] = await Promise.all([mergedSessions(db).catch(() => [] as SessionView[]), loadFloor(db)]);
  const live = merged.filter((s) => s.status !== "ended");
  const agentsQ = db.prepare(
    "SELECT agent_id, agent_type, started_at, ended_at FROM agents WHERE session IN (?, ?) AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at DESC LIMIT 40",
  );
  const tasksQ = db.prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE session IN (?, ?) GROUP BY status");
  const rooms: Room[] = live.map((s) => {
    const sid = s.session_id ?? (SAFE_ID.test(s.name) && !s.name.startsWith("hq-") ? s.name : null);
    const f =
      floor.find((r) => r.sid && sid && sid.startsWith(r.sid)) ??
      floor.find((r) => r.name === s.name || r.title === sessionLabel(s));
    // Agents still flagged running after 6 h lost their SubagentStop (crash, kill): not shown.
    const agents = (agentsQ.all(s.name, sid ?? s.name, now - 10 * 60_000) as AgentRow[]).filter(
      (a) => a.ended_at != null || now - a.started_at < 6 * 3600_000,
    );
    const counts = tasksQ.all(s.name, sid ?? s.name) as { status: string; n: number }[];
    const done = counts.filter((c) => c.status === "done").reduce((a, c) => a + Number(c.n), 0);
    const open = counts.filter((c) => c.status !== "done").reduce((a, c) => a + Number(c.n), 0);
    const usage = readUsage(sid);
    const busy = s.status === "running" || s.status === "needs_input";
    return {
      key: s.name,
      name: s.name,
      session_id: sid,
      label: sessionLabel(s),
      status: s.status,
      waiting: (s as SessionView & { waiting?: string | null }).waiting ?? null,
      ask: s.status === "needs_input" && sid ? readAsk(sid, s.cwd) : null,
      cwd: s.cwd,
      project: projectOf(s.cwd, now),
      delivery: deliveryOf(s),
      pending: sid ? pendingInbox(sid) : 0,
      inboxLive: sid ? inboxLive(sid) : false,
      doing: f?.caption || s.detail || null,
      state: f?.state ?? null,
      last_active: f && !f.unmatched && f.last_active != null ? f.last_active * 1000 : null,
      tokens: f?.tokens ?? null,
      model: usage?.model ?? s.model ?? null,
      usage,
      tasks: { done, open },
      cost_per_task: costPerTask(usage?.cost_usd, done),
      seats: seatsFor(agents, busy, now),
      role: s.role ?? null,
      team: teamOf(sid),
      meeting: null,
    };
  });
  const refs: RoomRef[] = rooms.map((r) => ({ key: r.key, ids: [r.name, r.session_id ?? "", r.label].filter(Boolean) }));
  const recent = db
    .prepare("SELECT kind, ts, session, from_, to_, text FROM messages WHERE kind = 'session_message' AND ts > ? ORDER BY id DESC LIMIT 50")
    .all(now - 120_000) as { kind: string; ts: number; session: string | null; from_: string | null; to_: string | null; text: string | null }[];
  const roots = new Map(rooms.flatMap((r) => (r.project ? [[r.project.root, r.project] as const] : [])));
  return { rooms, visits: visitsFrom(recent, refs, now), loops: readLoops([...roots.values()]), idle: readIdleStatus(), meetings: loadMeetings(rooms, now), at: now };
}
