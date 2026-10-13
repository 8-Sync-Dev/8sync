import type { DatabaseSync } from "node:sqlite";
import { stamp } from "./db";
import { setChannelState } from "./channel";
import { channelArgs, startTmux } from "./proc";

export type StartOpts = { name: string; projectId: number; cwd: string; role?: string | null; model?: string | null; port?: string; prompt?: string };

/** Starts the tmux session and records it (with role/model). Throws on channel config errors. */
export async function startHqSession(db: DatabaseSync, o: StartOpts) {
  const channel = channelArgs();
  const r = await startTmux(o.name, o.cwd, { channel, port: o.port, role: o.role ?? undefined, model: o.model ?? undefined, prompt: o.prompt });
  if (!r.ok) return { ok: false as const, stderr: r.stderr, channel };
  const now = Date.now();
  db.prepare(
    `INSERT INTO sessions(name, project_id, started_at, status, cwd, role, model, updated_at) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET project_id = excluded.project_id, started_at = excluded.started_at,
       status = 'running', cwd = excluded.cwd, role = excluded.role, model = excluded.model, updated_at = excluded.updated_at`,
  ).run(o.name, o.projectId, now, o.cwd, o.role ?? null, o.model ?? null, stamp());
  // A fresh process: forget what the previous one taught us about its channel.
  setChannelState(db, o.name, null);
  return { ok: true as const, startedAt: now, channel };
}
