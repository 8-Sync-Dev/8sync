import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath } from "./paths";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  name TEXT PRIMARY KEY,
  project_id INTEGER,
  started_at INTEGER,
  status TEXT NOT NULL DEFAULT 'running',
  cwd TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session TEXT,
  task_id TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  role TEXT,
  prio TEXT,
  status TEXT NOT NULL DEFAULT 'todo',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  session TEXT,
  team TEXT,
  kind TEXT NOT NULL,
  from_ TEXT,
  to_ TEXT,
  text TEXT
);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session, id);
CREATE INDEX IF NOT EXISTS tasks_updated ON tasks(updated_at);
CREATE TABLE IF NOT EXISTS channel_beats (
  session TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);
-- Claude session uuid -> the hq-* tmux name it runs in (from journal hq_session).
CREATE TABLE IF NOT EXISTS session_alias (
  session_id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
-- Sticky delivery facts about a session's channel: 'blocked-by-org' | 'unresponsive'.
CREATE TABLE IF NOT EXISTS channel_state (
  session TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  at INTEGER NOT NULL
);
-- Specialists (Claude Code subagents) inside a session's room, from SubagentStart/Stop hooks.
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  agent_type TEXT,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS agents_session ON agents(session, started_at);
CREATE TABLE IF NOT EXISTS ingest_state (
  file TEXT PRIMARY KEY,
  offset INTEGER NOT NULL
);
`;

const g = globalThis as unknown as { __hqDb?: { file: string; db: DatabaseSync } };

/** One connection per DB file (HOME can change between tests). */
export function getDb(): DatabaseSync {
  const file = dbPath();
  if (g.__hqDb?.file === file) return g.__hqDb.db;
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
  db.exec(SCHEMA);
  migrate(db);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try {
      fs.chmodSync(f, 0o600);
    } catch {
      /* wal/shm may not exist yet */
    }
  }
  g.__hqDb = { file, db };
  return db;
}

/** Additive column migrations for DBs created by an earlier build. */
function migrate(db: DatabaseSync): void {
  const scols = (db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).map((c) => c.name);
  // Team role the session was started with (lib/roles.ts) and the model it runs on.
  if (!scols.includes("role")) db.exec("ALTER TABLE sessions ADD COLUMN role TEXT");
  if (!scols.includes("model")) db.exec("ALTER TABLE sessions ADD COLUMN model TEXT");
  const cols = (db.prepare("PRAGMA table_info(messages)").all() as { name: string }[]).map((c) => c.name);
  // How an owner message reached the session: 'channel' | 'terminal' | 'channel→terminal' | 'failed'.
  // On a session_reply: 'terminal' when it came from the Stop hook, not the channel.
  if (!cols.includes("delivery")) db.exec("ALTER TABLE messages ADD COLUMN delivery TEXT");
  // Owner messages: when /api/channel/inbox first handed the row to the channel poller.
  if (!cols.includes("picked_up_at")) db.exec("ALTER TABLE messages ADD COLUMN picked_up_at INTEGER");
}

let last = 0;
/** Strictly increasing ms timestamp, so `updated_at > x` never misses a row. */
export function stamp(): number {
  last = Math.max(Date.now(), last + 1);
  return last;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type ProjectRow = { id: number; path: string; name: string; added_at: number };

/**
 * Flags projects whose folder is gone (old UAT temp dirs). Read-only: the row
 * and its sessions stay in the db, the sidebar just folds them away.
 */
export function withMissing<T extends { path: string }>(
  rows: T[],
  exists: (p: string) => boolean = fs.existsSync,
): (T & { missing: boolean })[] {
  return rows.map((r) => ({ ...r, missing: !exists(r.path) }));
}

/** Longest registered project path that contains `cwd`. */
export function projectIdFor(db: DatabaseSync, cwd: string | null | undefined): number | null {
  if (!cwd) return null;
  const rows = db.prepare("SELECT id, path FROM projects").all() as { id: number; path: string }[];
  let best: { id: number; len: number } | null = null;
  for (const r of rows) {
    if (cwd === r.path || cwd.startsWith(r.path.endsWith("/") ? r.path : r.path + "/")) {
      if (!best || r.path.length > best.len) best = { id: r.id, len: r.path.length };
    }
  }
  return best?.id ?? null;
}
