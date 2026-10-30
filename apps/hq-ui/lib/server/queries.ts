import type { DatabaseSync } from "node:sqlite";

export type MessageRow = {
  id: number;
  ts: number;
  session: string | null;
  kind: string;
  from_: string | null;
  to_: string | null;
  text: string | null;
  /** Owner messages only: 'channel' | 'terminal' | 'failed'. */
  delivery?: string | null;
  /** Session names of from_/to_ when known (listMessages only). */
  from_name?: string | null;
  to_name?: string | null;
};

export function insertMessage(db: DatabaseSync, m: Omit<MessageRow, "id">): MessageRow {
  const row = { ...m, delivery: m.delivery ?? null };
  const r = db
    .prepare("INSERT INTO messages(ts, session, kind, from_, to_, text, delivery) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(row.ts, row.session, row.kind, row.from_, row.to_, row.text, row.delivery);
  return { id: Number(r.lastInsertRowid), ...row };
}

export function ownerMessage(db: DatabaseSync, session: string, text: string, delivery: string | null = null): MessageRow {
  return insertMessage(db, {
    ts: Date.now(),
    session,
    kind: "owner_message",
    from_: "owner",
    to_: session,
    text,
    delivery,
  });
}

export function messagesAfter(
  db: DatabaseSync,
  f: {
    after?: number;
    session?: string | null;
    project?: number | null;
    kind?: string;
    delivery?: string;
    limit?: number;
  },
): MessageRow[] {
  const where = ["m.id > ?"];
  const args: (string | number)[] = [f.after ?? 0];
  if (f.session) {
    where.push("m.session = ?");
    args.push(f.session);
  }
  if (f.kind) {
    where.push("m.kind = ?");
    args.push(f.kind);
  }
  if (f.delivery) {
    where.push("m.delivery = ?");
    args.push(f.delivery);
  }
  if (f.project != null) {
    where.push("m.session IN (SELECT name FROM sessions WHERE project_id = ?)");
    args.push(f.project);
  }
  const n = Math.trunc(Number(f.limit ?? 500));
  // Interpolated into SQL below: always a plain integer.
  const limit = Number.isFinite(n) ? Math.min(Math.max(n, 1), 2000) : 500;
  // Newest N, returned oldest-first for timelines.
  return db
    .prepare(
      `SELECT * FROM (SELECT m.*, fn.name AS from_name, tn.name AS to_name FROM messages m
         LEFT JOIN session_names fn ON fn.session_id = m.from_
         LEFT JOIN session_names tn ON tn.session_id = m.to_
         WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT ${limit}) ORDER BY id`,
    )
    .all(...args) as MessageRow[];
}
