import type { DatabaseSync } from "node:sqlite";

export type MessageRow = {
  id: number;
  ts: number;
  session: string | null;
  team: string | null;
  kind: string;
  from_: string | null;
  to_: string | null;
  text: string | null;
};

export type TaskRow = {
  id: number;
  session: string | null;
  task_id: string;
  subject: string;
  role: string | null;
  prio: string | null;
  status: string;
  updated_at: number;
};

export function insertMessage(db: DatabaseSync, m: Omit<MessageRow, "id">): MessageRow {
  const r = db
    .prepare("INSERT INTO messages(ts, session, team, kind, from_, to_, text) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(m.ts, m.session, m.team, m.kind, m.from_, m.to_, m.text);
  return { id: Number(r.lastInsertRowid), ...m };
}

export function ownerMessage(db: DatabaseSync, session: string, text: string): MessageRow {
  return insertMessage(db, {
    ts: Date.now(),
    session,
    team: null,
    kind: "owner_message",
    from_: "owner",
    to_: session,
    text,
  });
}

export function messagesAfter(
  db: DatabaseSync,
  f: { after?: number; session?: string | null; team?: string | null; project?: number | null; kind?: string; limit?: number },
): MessageRow[] {
  const where = ["m.id > ?"];
  const args: (string | number)[] = [f.after ?? 0];
  if (f.session) {
    where.push("m.session = ?");
    args.push(f.session);
  }
  if (f.team) {
    where.push("m.team = ?");
    args.push(f.team);
  }
  if (f.kind) {
    where.push("m.kind = ?");
    args.push(f.kind);
  }
  if (f.project != null) {
    where.push("m.session IN (SELECT name FROM sessions WHERE project_id = ?)");
    args.push(f.project);
  }
  const limit = Math.min(Math.max(f.limit ?? 500, 1), 2000);
  // Newest N, returned oldest-first for timelines.
  return db
    .prepare(
      `SELECT * FROM (SELECT m.* FROM messages m WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT ${limit}) ORDER BY id`,
    )
    .all(...args) as MessageRow[];
}

export function tasksFor(db: DatabaseSync, project: number | null, updatedAfter = 0): TaskRow[] {
  const sql =
    project == null
      ? "SELECT * FROM tasks WHERE updated_at > ? ORDER BY updated_at DESC LIMIT 2000"
      : `SELECT t.* FROM tasks t JOIN sessions s ON s.name = t.session
         WHERE s.project_id = ? AND t.updated_at > ? ORDER BY t.updated_at DESC LIMIT 2000`;
  const args = project == null ? [updatedAfter] : [project, updatedAfter];
  return db.prepare(sql).all(...args) as TaskRow[];
}
