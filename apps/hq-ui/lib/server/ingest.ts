import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { projectIdFor, stamp, tx } from "./db";
import { journalFiles } from "./paths";
import { isTmuxName } from "./validate";

export const TASK_STATUSES = ["todo", "doing", "review", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export type JournalEvent = {
  v?: number;
  ts?: number;
  kind?: string;
  session_id?: string | null;
  /** Optional: the tmux name when the hook ran inside an HQ-started session. */
  hq_session?: string | null;
  team?: string | null;
  cwd?: string | null;
  task_id?: string | null;
  subject?: string | null;
  role?: string | null;
  prio?: string | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
  text?: string | null;
};

export type Mapped = {
  /** The Claude session uuid this row was keyed by, when no hq-* name was known. */
  sid?: string;
  /** Learned from a row carrying both: rows keyed by `session_id` belong to `name`. */
  alias?: { session_id: string; name: string };
  session?: { name: string; cwd: string | null; status: string | null; ts: number };
  task?: {
    task_id: string;
    session: string | null;
    subject: string | null;
    role: string | null;
    prio: string | null;
    status: TaskStatus;
  };
  message?: {
    ts: number;
    session: string | null;
    team: string | null;
    kind: string;
    from_: string | null;
    to_: string | null;
    text: string | null;
    delivery?: string | null;
  };
};

const MESSAGE_KINDS = new Set([
  "session_message",
  "teammate_idle",
  "notification",
  "session_start",
  "session_end",
]);

const SESSION_STATUS: Record<string, string | null> = {
  session_start: "running",
  session_end: "ended",
  teammate_idle: "idle",
  notification: "needs_input",
  session_message: "running",
  task_created: "running",
  task_completed: "running",
};

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Pure mapping from one journal line (contract §1) to DB effects. */
export function mapEvent(evt: JournalEvent): Mapped | null {
  const kind = str(evt.kind);
  if (!kind) return null;
  const ts = typeof evt.ts === "number" && Number.isFinite(evt.ts) ? evt.ts : Date.now();
  const hqRaw = str(evt.hq_session);
  const hq = hqRaw && isTmuxName(hqRaw) ? hqRaw : null;
  const sessionId = str(evt.session_id);
  const out: Mapped = {};
  if (hq && sessionId && sessionId !== hq) out.alias = { session_id: sessionId, name: hq };

  // session_reply from the Stop hook: the assistant's last message in an hq-*
  // session, shown in the Team chat as "<session> -> you". Without a valid
  // hq_session it has no session to belong to and is dropped.
  if (kind === "session_reply") {
    const text = str(evt.text);
    if (!hq || !text) return null;
    out.session = { name: hq, cwd: str(evt.cwd), status: "idle", ts };
    out.message = { ts, session: hq, team: str(evt.team), kind, from_: hq, to_: "owner", text, delivery: "terminal" };
    return out;
  }
  // owner_message is written by this UI's API only; a journal line claiming to
  // be one is dropped so the hook path cannot speak as the owner.
  if (!MESSAGE_KINDS.has(kind) && kind !== "task_created" && kind !== "task_completed") return null;
  const from = str(evt.from);
  const session = hq ?? (kind === "session_message" && from && isTmuxName(from) ? from : sessionId);
  if (session && session === sessionId && !hq) out.sid = sessionId;
  if (session) {
    out.session = { name: session, cwd: str(evt.cwd), status: SESSION_STATUS[kind] ?? null, ts };
  }
  const base = {
    ts,
    session,
    team: str(evt.team),
    kind,
    from_: str(evt.from),
    to_: str(evt.to),
    text: str(evt.text),
  };

  if (kind === "task_created" || kind === "task_completed") {
    const taskId = str(evt.task_id);
    if (!taskId) return null;
    const explicit = str(evt.status);
    const status: TaskStatus =
      kind === "task_completed"
        ? "done"
        : explicit && (TASK_STATUSES as readonly string[]).includes(explicit)
          ? (explicit as TaskStatus)
          : "todo";
    out.task = {
      task_id: taskId,
      session,
      subject: str(evt.subject),
      role: str(evt.role),
      prio: str(evt.prio),
      status,
    };
    out.message = { ...base, text: str(evt.subject) ?? base.text };
    return out;
  }
  if (MESSAGE_KINDS.has(kind)) {
    out.message = base;
    return out;
  }
  return null;
}

/** Rows keyed by a uuid we already know the hq-* name of are filed under that name. */
function resolveAlias(db: DatabaseSync, m: Mapped): Mapped {
  if (!m.sid) return m;
  const r = db.prepare("SELECT name FROM session_alias WHERE session_id = ?").get(m.sid) as { name: string } | undefined;
  if (!r) return m;
  const fix = <T extends { session: string | null } | { name: string }>(x: T | undefined): T | undefined => {
    if (!x) return x;
    if ("name" in x) return x.name === m.sid ? { ...x, name: r.name } : x;
    return x.session === m.sid ? { ...x, session: r.name } : x;
  };
  return { ...m, sid: undefined, session: fix(m.session), task: fix(m.task), message: fix(m.message) };
}

/**
 * Records uuid -> hq name once, and moves rows ingested before the name was
 * known (tasks, timeline, the uuid session row) onto the hq-* session.
 */
export function applyAlias(db: DatabaseSync, a: { session_id: string; name: string }): boolean {
  const known = db.prepare("SELECT name FROM session_alias WHERE session_id = ?").get(a.session_id) as
    | { name: string }
    | undefined;
  if (known?.name === a.name) return false;
  db.prepare(
    "INSERT INTO session_alias(session_id, name) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET name = excluded.name",
  ).run(a.session_id, a.name);
  db.prepare("UPDATE tasks SET session = ? WHERE session = ?").run(a.name, a.session_id);
  db.prepare("UPDATE messages SET session = ? WHERE session = ?").run(a.name, a.session_id);
  db.prepare(
    `INSERT INTO sessions(name, project_id, started_at, status, cwd, updated_at)
     SELECT ?, project_id, started_at, status, cwd, ? FROM sessions WHERE name = ?
     ON CONFLICT(name) DO UPDATE SET
       project_id = COALESCE(sessions.project_id, excluded.project_id),
       cwd = COALESCE(sessions.cwd, excluded.cwd),
       started_at = MIN(COALESCE(sessions.started_at, excluded.started_at), COALESCE(excluded.started_at, sessions.started_at)),
       updated_at = excluded.updated_at`,
  ).run(a.name, stamp(), a.session_id);
  db.prepare("DELETE FROM sessions WHERE name = ?").run(a.session_id);
  return true;
}

/** Same text from the channel's reply tool shortly before: the Stop hook copy is noise. */
const REPLY_DEDUPE_MS = 120_000;

export function applyMapped(db: DatabaseSync, input: Mapped): void {
  if (input.alias) applyAlias(db, input.alias);
  const m = resolveAlias(db, input);
  if (m.session) {
    const pid = projectIdFor(db, m.session.cwd);
    db.prepare(
      `INSERT INTO sessions(name, project_id, started_at, status, cwd, updated_at)
       VALUES (?, ?, ?, COALESCE(?, 'running'), ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         project_id = COALESCE(sessions.project_id, excluded.project_id),
         cwd = COALESCE(sessions.cwd, excluded.cwd),
         status = COALESCE(?, sessions.status),
         updated_at = excluded.updated_at`,
    ).run(m.session.name, pid, m.session.ts, m.session.status, m.session.cwd, stamp(), m.session.status);
  }
  if (m.task) {
    const t = m.task;
    db.prepare(
      `INSERT INTO tasks(session, task_id, subject, role, prio, status, updated_at)
       VALUES (?, ?, COALESCE(?, ?), ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         session = COALESCE(excluded.session, tasks.session),
         subject = COALESCE(?, tasks.subject),
         role = COALESCE(excluded.role, tasks.role),
         prio = COALESCE(excluded.prio, tasks.prio),
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).run(t.session, t.task_id, t.subject, t.task_id, t.role, t.prio, t.status, stamp(), t.subject);
  }
  if (m.message) {
    const x = m.message;
    if (x.kind === "session_reply") {
      const dup = db
        .prepare("SELECT 1 FROM messages WHERE kind = 'session_reply' AND session = ? AND text = ? AND ts >= ? LIMIT 1")
        .get(x.session, x.text, x.ts - REPLY_DEDUPE_MS);
      if (dup) return;
    }
    db.prepare(
      "INSERT INTO messages(ts, session, team, kind, from_, to_, text, delivery) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(x.ts, x.session, x.team, x.kind, x.from_, x.to_, x.text, x.delivery ?? null);
  }
}

/** Parses complete lines; returns how many bytes were consumed (up to the last '\n'). */
export function parseChunk(buf: Buffer): { events: JournalEvent[]; consumed: number } {
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return { events: [], consumed: 0 };
  const events: JournalEvent[] = [];
  for (const line of buf.subarray(0, end).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === "object") events.push(v as JournalEvent);
    } catch {
      /* skip a corrupt line rather than wedge ingestion */
    }
  }
  return { events, consumed: end + 1 };
}

const MAX_READ = 8 * 1024 * 1024;

function readFrom(file: string, offset: number): Buffer {
  let fd: number;
  try {
    fd = fs.openSync(file, "r");
  } catch {
    return Buffer.alloc(0);
  }
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(Math.max(size - offset, 0), MAX_READ);
    const buf = Buffer.alloc(len);
    const n = len ? fs.readSync(fd, buf, 0, len, offset) : 0;
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function getState(db: DatabaseSync, key: string): number | null {
  const r = db.prepare("SELECT offset FROM ingest_state WHERE file = ?").get(key) as
    | { offset: number }
    | undefined;
  return r ? Number(r.offset) : null;
}

function setState(db: DatabaseSync, key: string, value: number): void {
  db.prepare(
    "INSERT INTO ingest_state(file, offset) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset",
  ).run(key, value);
}

/**
 * Ingests new journal lines by byte offset. Fully synchronous, so two requests
 * in the same process can never interleave. Handles one rotation between runs:
 * the tail of the old file is read from events.1.jsonl, then the new file from 0.
 */
export function ingest(db: DatabaseSync): number {
  const { current, rotated } = journalFiles();
  let st: fs.Stats;
  try {
    st = fs.statSync(current);
  } catch {
    return 0;
  }
  return tx(db, () => {
    let offset = getState(db, "events.jsonl") ?? 0;
    const ino = getState(db, "ino:events.jsonl");
    let count = 0;
    const run = (buf: Buffer) => {
      const { events, consumed } = parseChunk(buf);
      for (const e of events) {
        const m = mapEvent(e);
        if (m) {
          applyMapped(db, m);
          count++;
        }
      }
      return consumed;
    };
    const rotatedNow = (ino !== null && ino !== st.ino) || st.size < offset;
    if (rotatedNow) {
      if (offset > 0) run(readFrom(rotated, offset));
      offset = 0;
    }
    offset += run(readFrom(current, offset));
    setState(db, "events.jsonl", offset);
    setState(db, "ino:events.jsonl", st.ino);
    return count;
  });
}
