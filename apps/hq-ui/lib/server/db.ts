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
