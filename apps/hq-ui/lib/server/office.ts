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
import { costPerTask, roomFor, seatsFor, visitsFrom, type AgentRow, type Limits, type ProjectInfo, type RoomRef, type Seat, type Usage, type Visit } from "../office";
import { boardTasks } from "../now";
import { attendeesNow, MEETING_MS, parseStandupDay, walkPhase, type Attendee, type WalkPhase } from "../meeting";
import { companyScope, parsePins, type HiddenProject, type Pin } from "../sidebar";
import { readAsk, transcriptOf } from "./ask";
import { lastAutoStatus } from "./auto";
import { projectBoards, type ProjectBoard } from "./board";
import { loadFloor, ompSessions } from "./floor";
import { readPermits, type Permit } from "./permit";
import { readIdleStatus } from "./idle";
import { inboxLive, pendingInbox } from "./inbox";
import { pinnedRootsPath, stateDir } from "./paths";
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

const TS_RE = /"timestamp":"([^"]{10,40})"/g;
const MODEL_RE = /"model":"([^"<]+)"/;
const EDIT_TOOL_RE = /"name":"(Write|Edit|MultiEdit|NotebookEdit)"/;
const CHUNK_BYTES = 4 * 1024 * 1024;

/** `offset`: bytes of the transcript consumed so far (whole lines); the next read starts there. */
export type TranscriptStats = { model: string | null; first: number | null; last: number | null; lines_added: number; lines_removed: number; offset: number };
/** `written`: line count of the last `Write` per file, so a rewrite counts the old content as removed. */
type Measured = TranscriptStats & { size: number; mtime: number; written: Map<string, number> };
const measured = new Map<string, Measured>();

const nLines = (s: unknown) => (typeof s === "string" && s.length ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0);

type ToolUse = { type?: string; name?: string; input?: Record<string, unknown> };

/** Lines a `Write` / `Edit` / `MultiEdit` / `NotebookEdit` call adds and removes, folded into `m`. */
function countEdit(m: Measured, b: ToolUse): void {
  const i = b.input ?? {};
  switch (b.name) {
    case "Write": {
      const n = nLines(i.content);
      const file = typeof i.file_path === "string" ? i.file_path : "";
      m.lines_removed += m.written.get(file) ?? 0;
      m.written.set(file, n);
      m.lines_added += n;
      break;
    }
    case "Edit":
      m.lines_removed += nLines(i.old_string);
      m.lines_added += nLines(i.new_string);
      break;
    case "MultiEdit":
      for (const e of Array.isArray(i.edits) ? (i.edits as Record<string, unknown>[]) : []) {
        m.lines_removed += nLines(e?.old_string);
        m.lines_added += nLines(e?.new_string);
      }
      break;
    case "NotebookEdit":
      m.lines_added += nLines(i.new_source);
      break;
  }
}

/** Folds one transcript line into `m`: timestamps, the model an assistant line names, its edit tool calls. */
function scanLine(m: Measured, line: string): void {
  for (const t of line.matchAll(TS_RE)) {
    const at = Date.parse(t[1]);
    if (!Number.isFinite(at)) continue;
    if (m.first == null || at < m.first) m.first = at;
    if (m.last == null || at > m.last) m.last = at;
  }
  if (!line.includes('"type":"assistant"')) return;
  m.model = MODEL_RE.exec(line)?.[1] ?? m.model;
  if (!line.includes('"type":"tool_use"') || !EDIT_TOOL_RE.test(line)) return;
  try {
    // JSON.parse is `any`; the content blocks are checked one by one in countEdit.
    const content: unknown = JSON.parse(line)?.message?.content;
    for (const b of Array.isArray(content) ? (content as ToolUse[]) : []) if (b?.type === "tool_use") countEdit(m, b);
  } catch {
    /* a truncated or foreign line: no edit counted */
  }
}

/**
 * Model, first / last timestamp and lines added / removed (from `Write` / `Edit` / `MultiEdit` /
 * `NotebookEdit` calls) of a room's Claude Code transcript, for rooms that run no status line.
 * The file is append-only: each call parses only the whole lines appended since the last one
 * (from scratch when it shrank or its mtime went back), so polls after the first cost ~ms.
 */
export function readTranscriptStats(sessionId: string | null | undefined, cwd: string | null, root?: string): TranscriptStats | null {
  const f = sessionId ? transcriptOf(sessionId, cwd, root) : null;
  if (!f) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(f);
  } catch {
    return null;
  }
  const hit = measured.get(f);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit;
  const m: Measured =
    hit && st.size >= hit.size && st.mtimeMs >= hit.mtime
      ? { ...hit, written: new Map(hit.written) }
      : { model: null, first: null, last: null, lines_added: 0, lines_removed: 0, offset: 0, size: 0, mtime: 0, written: new Map() };
  let fd: number | null = null;
  try {
    fd = fs.openSync(f, "r");
    // `carry`: the chunks of a line not ended yet (joined once it ends, not per chunk).
    let carry: Buffer[] = [];
    let carried = 0;
    while (m.offset + carried < st.size) {
      const want = Math.min(CHUNK_BYTES, st.size - m.offset - carried);
      const buf = Buffer.allocUnsafe(want);
      const got = fs.readSync(fd, buf, 0, want, m.offset + carried);
      if (got <= 0) break;
      const chunk = buf.subarray(0, got);
      const end = chunk.lastIndexOf(10);
      if (end < 0) {
        carry.push(chunk);
        carried += got;
        continue;
      }
      const all = carry.length ? Buffer.concat([...carry, chunk.subarray(0, end)]) : chunk.subarray(0, end);
      for (const line of all.toString("utf8").split("\n")) scanLine(m, line);
      m.offset += carried + end + 1;
      carry = [chunk.subarray(end + 1)];
      carried = got - end - 1;
    }
    m.size = st.size;
    m.mtime = st.mtimeMs;
    // A session whose latest lines are all one huge tool result names no time: the write time stands in.
    if (m.last == null) m.last = Math.round(st.mtimeMs);
    measured.set(f, m);
    return m;
  } catch {
    return hit ?? null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

/**
 * Plan limits from the freshest usage snapshot that carries any (contract C1; Claude Code gives the
 * status line `rate_limits` only on a subscription). Newest files first, at most 5 read; null when none.
 */
export function readLimits(): Limits | null {
  const dir = path.join(stateDir(), "usage");
  let files: { f: string; at: number }[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".json") && SAFE_ID.test(n.slice(0, -5)))
      .flatMap((n) => {
        try {
          return [{ f: path.join(dir, n), at: fs.statSync(path.join(dir, n)).mtimeMs }];
        } catch {
          return [];
        }
      });
  } catch {
    return null;
  }
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  for (const { f } of files.sort((a, b) => b.at - a.at).slice(0, 5)) {
    try {
      const v = JSON.parse(readSafe(f) ?? "");
      const l: Limits = {
        five_hour_pct: n(v.five_hour_pct),
        five_hour_resets_at: n(v.five_hour_resets_at),
        seven_day_pct: n(v.seven_day_pct),
        seven_day_resets_at: n(v.seven_day_resets_at),
        ts: n(v.ts),
      };
      if (l.five_hour_pct != null || l.seven_day_pct != null) return l;
    } catch {
      /* half-written snapshot: try the next one */
    }
  }
  return null;
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
  /** A permission request waiting for the owner's click while the room's hook counts down (`ccc hook permit`). */
  permit: Permit | null;
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
  /** Which team the room belongs to (contract C4): "ccc" (Claude Code) or "omp". */
  engine: string;
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

/** `pinned-roots.json` (`8sync ccc auto pin`), oldest pin first, without Rust's `\\?\` prefix; [] when absent or unreadable. */
export function readPins(file = pinnedRootsPath()): Pin[] {
  try {
    return parsePins(JSON.parse(fs.readFileSync(file, "utf8"))).map((p) => ({ ...p, root: p.root.replace(/^\\\\\?\\/, "") }));
  } catch {
    return [];
  }
}

/**
 * `idle`: every agent-team member's "không ai rảnh" status (lib/idle.ts), stale ones included. `limits`: plan usage (header).
 * `hidden`: projects the owner closed in the sidebar (lib/sidebar.ts splitClosed decides which still hide).
 * `pins`: projects the owner pinned (sidebar "Ghim", lib/sidebar.ts pinSidebar).
 */
export type Office = { rooms: Room[]; visits: Visit[]; loops: LoopInfo[]; idle: IdleRecord[]; meetings: Meeting[]; limits: Limits | null; hidden: HiddenProject[]; pins: Pin[]; at: number; /** One team for every project (`auto company on`), from the last auto status poll. */ company: boolean; /** The company's repos (lib/sidebar.ts companyScope); empty when company is off. */ scope: string[]; /** Where a team runs (`team_roots` of the last auto status, canonical roots): the company team's rooms live only there. */ team_roots: string[] };

export async function loadOffice(db: DatabaseSync, now = Date.now()): Promise<Office> {
  const [merged, floor] = await Promise.all([mergedSessions(db).catch(() => [] as SessionView[]), loadFloor(db)]);
  // Both teams: Claude Code sessions, then the omp rooms `8sync ls` reports live (contract C4).
  const live = [...merged.filter((s) => s.status !== "ended"), ...ompSessions(db, floor)];
  const agentsQ = db.prepare(
    "SELECT agent_id, agent_type, started_at, ended_at FROM agents WHERE session IN (?, ?) AND (ended_at IS NULL OR ended_at > ?) ORDER BY started_at DESC LIMIT 40",
  );
  const tasksQ = db.prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE session IN (?, ?) GROUP BY status");
  const permits = readPermits(now);
  const projects = new Map(
    live.flatMap((s) => {
      const p = projectOf(s.cwd, now);
      return p ? [[p.root, p] as const] : [];
    }),
  );
  // Tasks come from the project boards (cards a room moved on / holds); the HQ task journal only when no board is readable.
  const boards = await projectBoards([...projects.values()]).catch(() => [] as ProjectBoard[]);
  const rooms: Room[] = live.map((s) => {
    const sid = s.session_id ?? (SAFE_ID.test(s.name) && !s.name.startsWith("hq-") ? s.name : null);
    const f =
      floor.find((r) => r.inbox_id && r.inbox_id === sid) ??
      floor.find((r) => r.sid && sid && sid.startsWith(r.sid)) ??
      floor.find((r) => r.name === s.name || r.title === sessionLabel(s));
    // Agents still flagged running after 6 h lost their SubagentStop (crash, kill): not shown.
    const agents = (agentsQ.all(s.name, sid ?? s.name, now - 10 * 60_000) as AgentRow[]).filter(
      (a) => a.ended_at != null || now - a.started_at < 6 * 3600_000,
    );
    const counts = tasksQ.all(s.name, sid ?? s.name) as { status: string; n: number }[];
    const journal = {
      done: counts.filter((c) => c.status === "done").reduce((a, c) => a + Number(c.n), 0),
      open: counts.filter((c) => c.status !== "done").reduce((a, c) => a + Number(c.n), 0),
    };
    const label = sessionLabel(s);
    const tasks = boardTasks({ label, cwd: s.cwd, started_at: s.started_at }, boards) ?? journal;
    // The status-line snapshot (cost, lines) when the room writes one; model and time from its transcript otherwise.
    const snap = readUsage(sid);
    const tr = s.engine === "omp" ? null : readTranscriptStats(sid, s.cwd);
    const usage: Usage | null =
      snap || tr
        ? {
            cost_usd: snap?.cost_usd ?? null,
            duration_ms: snap?.duration_ms ?? (tr?.first != null && tr.last != null ? Math.max(0, tr.last - tr.first) : null),
            lines_added: snap?.lines_added ?? tr?.lines_added ?? null,
            lines_removed: snap?.lines_removed ?? tr?.lines_removed ?? null,
            context_pct: snap?.context_pct ?? null,
            model: snap?.model ?? tr?.model ?? null,
          }
        : null;
    const busy = s.status === "running" || s.status === "needs_input";
    return {
      key: s.name,
      name: s.name,
      session_id: sid,
      label,
      status: s.status,
      waiting: (s as SessionView & { waiting?: string | null }).waiting ?? null,
      ask: s.status === "needs_input" && sid ? readAsk(sid, s.cwd) : null,
      permit: (sid && permits.find((p) => p.session === sid)) || null,
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
      tasks,
      cost_per_task: costPerTask(usage?.cost_usd, tasks.done),
      seats: seatsFor(agents, busy, now),
      role: s.role ?? null,
      team: teamOf(sid),
      engine: s.engine ?? "ccc",
      meeting: null,
    };
  });
  const refs: RoomRef[] = rooms.map((r) => ({ key: r.key, ids: [r.name, r.session_id ?? "", r.label].filter(Boolean) }));
  const recent = db
    .prepare("SELECT kind, ts, session, from_, to_, text FROM messages WHERE kind = 'session_message' AND ts > ? ORDER BY id DESC LIMIT 50")
    .all(now - 120_000) as { kind: string; ts: number; session: string | null; from_: string | null; to_: string | null; text: string | null }[];
  const roots = lastAutoStatus()?.team_roots;
  return {
    rooms,
    visits: visitsFrom(recent, refs, now),
    loops: readLoops([...projects.values()]),
    idle: readIdleStatus(),
    meetings: loadMeetings(rooms, now),
    limits: readLimits(),
    hidden: db.prepare("SELECT key, root, name, hidden_at FROM hidden_projects ORDER BY hidden_at DESC").all() as HiddenProject[],
    pins: readPins(),
    at: now,
    company: lastAutoStatus()?.company === true,
    scope: companyScope(lastAutoStatus()),
    team_roots: Array.isArray(roots) ? roots.filter((r): r is string => typeof r === "string" && r.length > 0 && r.length <= 1024) : [],
  };
}
