import type { DatabaseSync } from "node:sqlite";
import { stamp } from "./db";
import { setChannelState } from "./channel";
import { channelArgs, hasTmux, run, startTmux } from "./proc";

export type StartOpts = { name: string; projectId: number; cwd: string; role?: string | null; model?: string | null; port?: string; prompt?: string };

/**
 * Windows has no tmux (owner 2026-10-22: "terminal claude không mở được ở dự án su-code": every HQ
 * start failed there). A Claude Code background session instead, started like a team room
 * (crates/cli/src/verbs/ccc/team.rs: `--bg --name <name> --permission-mode auto`); `claude agents`
 * lists it and its terminal is `claude attach`. Pure; tested in tests/start-bg.test.ts.
 */
export function bgArgs(o: Pick<StartOpts, "name" | "model" | "prompt">): string[] {
  return ["--bg", "--name", o.name, "--permission-mode", "auto", ...(o.model ? ["--model", o.model] : []), ...(o.prompt ? [o.prompt.startsWith("-") ? ` ${o.prompt}` : o.prompt] : [])];
}

/** Starts the session (tmux; a background session where there is no tmux, e.g. Windows) and records a tmux one (with role/model). Throws on channel config errors. */
export async function startHqSession(db: DatabaseSync, o: StartOpts) {
  if (!(await hasTmux())) {
    const r = await run("claude", bgArgs(o), 60_000, o.cwd);
    const channel = { args: [] as string[], mode: "off" as const, reason: "background session (Windows has no tmux): reply in its terminal" };
    // `claude agents` reports it (status, cwd, session id); a journal row named by the title would
    // only show up again as a second, ended entry.
    return r.ok ? { ok: true as const, startedAt: Date.now(), channel } : { ok: false as const, stderr: r.stderr || r.stdout, channel };
  }
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
