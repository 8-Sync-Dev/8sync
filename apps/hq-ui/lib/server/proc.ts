import { execFile } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { projectIdFor } from "./db";
import { CHANNEL_FLAGS_RE, isTmuxName } from "./validate";

type Run = { ok: boolean; stdout: string; stderr: string };

/** argv-only process runner (never a shell), with a hard timeout. */
export function run(cmd: string, args: string[], timeoutMs = 4000): Promise<Run> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

export type TmuxSession = { name: string; created: number; pid: number | null; cwd: string | null };

export async function listTmux(): Promise<TmuxSession[]> {
  const r = await run("tmux", [
    "list-sessions",
    "-F",
    "#{session_name}\t#{session_created}\t#{pane_pid}\t#{pane_current_path}",
  ]);
  if (!r.ok) return []; // no server running is the common case
  return r.stdout
    .split("\n")
    .map((l) => l.split("\t"))
    .filter(([name]) => isTmuxName(name))
    .map(([name, created, pid, cwd]) => ({
      name,
      created: Number(created) * 1000,
      pid: Number(pid) || null,
      cwd: cwd || null,
    }));
}

export type ClaudeAgent = {
  pid?: number;
  cwd?: string;
  kind?: string;
  startedAt?: number;
  sessionId?: string;
  name?: string;
  status?: string;
  waitingFor?: string;
};

/** null when `claude` is missing or failed: callers then trust the journal. */
export async function listClaudeAgents(): Promise<ClaudeAgent[] | null> {
  const r = await run("claude", ["agents", "--json"], 5000);
  if (!r.ok) return null;
  try {
    const v = JSON.parse(r.stdout);
    return Array.isArray(v) ? (v as ClaudeAgent[]) : null;
  } catch {
    return null;
  }
}

export type SessionStatus = "running" | "idle" | "needs_input" | "ended";

export type SessionView = {
  name: string;
  label: string;
  session_id: string | null;
  project_id: number | null;
  status: SessionStatus;
  started_at: number | null;
  cwd: string | null;
  tmux: boolean;
  source: "tmux" | "claude" | "journal";
  detail: string | null;
};

function agentStatus(s: string | undefined): SessionStatus {
  if (s === "waiting") return "needs_input";
  if (s === "idle") return "idle";
  return "running";
}

function normStatus(s: string | null | undefined): SessionStatus {
  return s === "idle" || s === "needs_input" || s === "ended" ? s : "running";
}

/**
 * Merges three sources: tmux `hq-*` sessions, `claude agents --json`, and the
 * journal-derived sessions table. A tmux pane's pid is the claude pid (tmux's
 * shell execs `env`, which execs `claude`), which links the first two.
 */
export async function mergedSessions(db: DatabaseSync): Promise<SessionView[]> {
  const [tmux, listed] = await Promise.all([listTmux(), listClaudeAgents()]);
  const agents = listed ?? [];
  const rows = db
    .prepare("SELECT name, project_id, started_at, status, cwd FROM sessions")
    .all() as { name: string; project_id: number | null; started_at: number | null; status: string; cwd: string | null }[];
  const byName = new Map(rows.map((r) => [r.name, r]));
  const out = new Map<string, SessionView>();
  const usedAgents = new Set<string>();

  for (const t of tmux) {
    const agent = agents.find((a) => a.pid && a.pid === t.pid);
    if (agent?.sessionId) usedAgents.add(agent.sessionId);
    const row = byName.get(t.name);
    const cwd = row?.cwd ?? agent?.cwd ?? t.cwd;
    out.set(t.name, {
      name: t.name,
      label: t.name,
      session_id: agent?.sessionId ?? null,
      project_id: row?.project_id ?? projectIdFor(db, cwd),
      status: agent ? agentStatus(agent.status) : normStatus(row?.status === "ended" ? "running" : row?.status),
      started_at: row?.started_at ?? t.created,
      cwd,
      tmux: true,
      source: "tmux",
      detail: agent?.waitingFor ?? null,
    });
  }
  for (const a of agents) {
    if (!a.sessionId || usedAgents.has(a.sessionId)) continue;
    const row = byName.get(a.sessionId);
    out.set(a.sessionId, {
      name: a.sessionId,
      label: a.name || a.sessionId.slice(0, 8),
      session_id: a.sessionId,
      project_id: row?.project_id ?? projectIdFor(db, a.cwd),
      status: agentStatus(a.status),
      started_at: a.startedAt ?? row?.started_at ?? null,
      cwd: a.cwd ?? row?.cwd ?? null,
      tmux: false,
      source: "claude",
      detail: a.waitingFor ?? null,
    });
  }
  for (const r of rows) {
    if (out.has(r.name) || [...out.values()].some((s) => s.session_id === r.name)) continue;
    out.set(r.name, {
      name: r.name,
      label: isTmuxName(r.name) ? r.name : r.name.slice(0, 8),
      session_id: isTmuxName(r.name) ? null : r.name,
      project_id: r.project_id ?? projectIdFor(db, r.cwd),
      // Not alive in tmux or `claude agents`: it is gone. Without `claude`, trust the journal.
      status: listed ? "ended" : normStatus(r.status),
      started_at: r.started_at,
      cwd: r.cwd,
      tmux: false,
      source: "journal",
      detail: null,
    });
  }
  return [...out.values()].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));
}

/** Contract §3: the channel flag string. */
export function channelFlags(): string {
  // TODO(hq-ui-contract §3): another agent finalizes the channel flags for the
  // 8sync-hq plugin; until then this is the documented default.
  const flags = process.env.HQ_CHANNEL_FLAGS ?? "--channels plugin:8sync-hq@8sync";
  if (!CHANNEL_FLAGS_RE.test(flags)) throw new Error("HQ_CHANNEL_FLAGS contains unsupported characters");
  return flags;
}

/**
 * Builds the tmux argv. `name` and `cwd` must already be validated
 * (TMUX_NAME_RE, existing absolute dir). The shell command string only
 * contains the validated name and owner-set flags; the path goes in `-c`.
 */
export function tmuxStartArgs(name: string, cwd: string): string[] {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  const command = `env EIGHTSYNC_HQ_SESSION=${name} claude ${channelFlags()}`.trim();
  return ["new-session", "-d", "-s", name, "-c", cwd, command];
}

export async function startTmux(name: string, cwd: string): Promise<Run> {
  return run("tmux", tmuxStartArgs(name, cwd));
}

export async function stopTmux(name: string): Promise<Run> {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  return run("tmux", ["kill-session", "-t", `=${name}`]);
}

export async function captureTmux(name: string): Promise<Run> {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  return run("tmux", ["capture-pane", "-p", "-e", "-t", `=${name}:`]);
}
