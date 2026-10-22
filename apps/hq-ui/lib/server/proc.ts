import { execFile } from "node:child_process";
import { staleJournal } from "../sessions-list";
import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { roomLabel } from "@/lib/room-label";
import { isModelId, isRoleId } from "@/lib/roles";
import { projectIdFor } from "./db";
import fs from "node:fs";
import path from "node:path";
import { binFor, childEnv } from "./child-env";
import { coreGet } from "./core";
import { inboxLive } from "./inbox";
import { channelMcpConfigPath } from "./paths";
import { CHANNEL_FLAGS_RE, TMUX_NAME_RE, hasControlChars, isTmuxName } from "./validate";

/** `killed`: the timeout (or a signal) stopped it, so it may have done part of its work. */
type Run = { ok: boolean; stdout: string; stderr: string; killed?: boolean };

/**
 * argv-only process runner (never a shell), with a hard timeout; `cwd` defaults to the server's.
 * The child gets the scrubbed env (no HQ_* / PORT / HOSTNAME / NODE_ENV); `8sync` is the binary that
 * started this HQ (contract C-E).
 */
export function run(cmd: string, args: string[], timeoutMs = 4000, cwd?: string): Promise<Run> {
  return new Promise((resolve) => {
    execFile(binFor(cmd), args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, cwd, env: childEnv() }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), ...(err?.killed ? { killed: true } : {}) });
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

/** null when `claude` is missing or failed (past AGENTS_KEEP_MS): no session is known alive then; journal rows stay ended. The core keeps this warm. */
/** A listing this young answers every caller (all routes and clients poll together). */
const AGENTS_FRESH_MS = 2_000;
/** A failed probe answers with the last good listing while it is this young: a slow `claude` under
 * load is not "no room runs" (rooms would show as ids with their last journal status). */
const AGENTS_KEEP_MS = 120_000;
let agentsLast: { at: number; v: ClaudeAgent[] } | null = null;
let agentsFlight: Promise<ClaudeAgent[] | null> | null = null;

async function probeAgents(): Promise<ClaudeAgent[] | null> {
  const viaCore = await coreGet("/v1/agents");
  if (viaCore) return Array.isArray(viaCore.v) ? (viaCore.v as ClaudeAgent[]) : null;
  const r = await run("claude", ["agents", "--json"], 5000);
  if (!r.ok) return null;
  try {
    const v = JSON.parse(r.stdout);
    return Array.isArray(v) ? (v as ClaudeAgent[]) : null;
  } catch {
    return null;
  }
}

/**
 * `claude agents --json` (through the core when HQ has one). One probe in flight for the whole
 * server: concurrent callers share it (2026-10-21 a slow core made every poll start its own
 * `claude agents`, 15 at once, which made claude slower still).
 */
export async function listClaudeAgents(now: () => number = Date.now): Promise<ClaudeAgent[] | null> {
  if (agentsLast && now() - agentsLast.at < AGENTS_FRESH_MS) return agentsLast.v;
  agentsFlight ??= probeAgents().finally(() => {
    agentsFlight = null;
  });
  const v = await agentsFlight;
  if (v) {
    agentsLast = { at: now(), v };
    return v;
  }
  return agentsLast && now() - agentsLast.at < AGENTS_KEEP_MS ? agentsLast.v : null;
}

/** Tests: forget the shared listing. */
export function resetAgentsCache(): void {
  agentsLast = null;
  agentsFlight = null;
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
  /** `omp`: an omp-team room from `8sync ls` (lib/server/floor.ts ompSessions), reached only through its inbox. */
  source: "tmux" | "claude" | "journal" | "omp";
  detail: string | null;
  /** Inbox delivery only: the `8sync-inbox` mod polled within LIVE_MS, so a task enters as soon as the session is idle. */
  inbox_live: boolean;
  /** Team role / model the session was started with (null for sessions started elsewhere). */
  role?: string | null;
  model?: string | null;
  /** Team (contract C4): absent = Claude Code (ccc); "omp" for omp rooms. */
  engine?: string;
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
 * Only tmux and `claude agents` prove a session alive: journal-only rows are always "ended".
 */
export async function mergedSessions(db: DatabaseSync): Promise<SessionView[]> {
  const [tmux, listed] = await Promise.all([listTmux(), listClaudeAgents()]);
  // Past AGENTS_KEEP_MS without an answer nothing is known alive: journal rows stay ended (below).
  const agents = listed ?? [];
  const rows = db
    .prepare("SELECT name, project_id, started_at, status, cwd, role, model, updated_at FROM sessions")
    .all() as { name: string; project_id: number | null; started_at: number | null; status: string; cwd: string | null; role: string | null; model: string | null; updated_at: number | null }[];
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
      inbox_live: false,
    });
  }
  for (const a of agents) {
    if (!a.sessionId || usedAgents.has(a.sessionId)) continue;
    const row = byName.get(a.sessionId);
    out.set(a.sessionId, {
      name: a.sessionId,
      label: roomLabel(a.name, a.sessionId.slice(0, 8)),
      session_id: a.sessionId,
      project_id: row?.project_id ?? projectIdFor(db, a.cwd),
      status: agentStatus(a.status),
      started_at: a.startedAt ?? row?.started_at ?? null,
      cwd: a.cwd ?? row?.cwd ?? null,
      tmux: false,
      source: "claude",
      detail: a.waitingFor ?? null,
      inbox_live: inboxLive(a.sessionId),
    });
  }
  // Gone sessions untouched for days: drop their journal row (lib/sessions-list.ts staleJournal; messages stay).
  const now = Date.now();
  const drop = db.prepare("DELETE FROM sessions WHERE name = ?");
  for (const r of rows) {
    if (out.has(r.name) || [...out.values()].some((s) => s.session_id === r.name)) continue;
    if (staleJournal(r, false, listed != null, now)) {
      drop.run(r.name);
      continue;
    }
    out.set(r.name, {
      name: r.name,
      label: TMUX_NAME_RE.test(r.name) ? r.name : r.name.slice(0, 8),
      session_id: TMUX_NAME_RE.test(r.name) ? null : r.name,
      project_id: r.project_id ?? projectIdFor(db, r.cwd),
      // Not alive in tmux or `claude agents` (or its last good answer): it is gone, whatever the journal says.
      status: "ended",
      started_at: r.started_at,
      cwd: r.cwd,
      tmux: false,
      source: "journal",
      detail: null,
      inbox_live: false,
    });
  }
  return [...out.values()]
    .map((s) => ({ ...s, role: byName.get(s.name)?.role ?? null, model: byName.get(s.name)?.model ?? null }))
    .sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0));
}

export type ChannelMode = { args: string[]; mode: "channel" | "off"; reason: string | null };

/**
 * Contract §3: the claude flags that load the 8sync-hq channel.
 * - HQ_CHANNEL_FLAGS unset: the documented default, but only when the
 *   generated channel-mcp.json exists (else claude would refuse to start).
 * - HQ_CHANNEL_FLAGS=off: no channel, owner messages use the tmux fallback.
 * - anything else: whitespace-split into argv (never a shell string); a
 *   leading `~/` is expanded to $HOME.
 */
export function channelArgs(env: Record<string, string | undefined> = process.env, home = os.homedir()): ChannelMode {
  const raw = env.HQ_CHANNEL_FLAGS?.trim();
  if (raw === "off") return { args: [], mode: "off", reason: "HQ_CHANNEL_FLAGS=off" };
  if (raw) {
    if (!CHANNEL_FLAGS_RE.test(raw)) throw new Error("HQ_CHANNEL_FLAGS contains unsupported characters");
    const args = raw.split(/\s+/).map((a) => (a.startsWith("~/") ? path.join(home, a.slice(2)) : a));
    return { args, mode: "channel", reason: null };
  }
  const cfg = channelMcpConfigPath(home);
  if (!fs.existsSync(cfg)) {
    return { args: [], mode: "off", reason: `${cfg} not found (run the hq-channel mcp-config step)` };
  }
  return {
    args: ["--mcp-config", cfg, "--dangerously-load-development-channels", "server:8sync-hq"],
    mode: "channel",
    reason: null,
  };
}

/**
 * Builds the tmux argv. `name` and `cwd` must already be validated
 * (TMUX_NAME_RE, existing absolute dir). tmux >= 3.0 execs a multi-argument
 * command directly, so no shell ever parses it: the contract's
 * `env EIGHTSYNC_HQ_SESSION=hq-<name> claude <flags>` as an argv.
 */
export function tmuxStartArgs(
  name: string,
  cwd: string,
  opts: { channel?: ChannelMode; port?: string; model?: string; role?: string; prompt?: string } = {},
): string[] {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  const ch = opts.channel ?? channelArgs();
  const envs = [`EIGHTSYNC_HQ_SESSION=${name}`];
  if (ch.mode === "channel") envs.push("MCP_PROTOCOL_NEGOTIATION=legacy");
  if (opts.port && /^\d{1,5}$/.test(opts.port)) envs.push(`HQ_UI_PORT=${opts.port}`);
  // Only allowlisted values reach argv (lib/roles.ts); anything else is refused here too.
  if (opts.role) {
    if (!isRoleId(opts.role)) throw new Error("invalid role");
    envs.push(`EIGHTSYNC_HQ_ROLE=${opts.role}`);
  }
  const model: string[] = [];
  if (opts.model) {
    if (!isModelId(opts.model)) throw new Error("invalid model");
    model.push("--model", opts.model);
  }
  // A first prompt (a task assigned at start) goes after `--`, so it is never read as a flag and waits behind any boot dialog.
  const prompt = opts.prompt?.trim() ? ["--", opts.prompt] : [];
  return ["new-session", "-d", "-s", name, "-c", cwd, "--", "env", ...envs, "claude", ...model, ...ch.args, ...prompt];
}

export async function startTmux(name: string, cwd: string, opts: Parameters<typeof tmuxStartArgs>[2] = {}): Promise<Run> {
  return run("tmux", tmuxStartArgs(name, cwd, opts));
}

export async function stopTmux(name: string): Promise<Run> {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  return run("tmux", ["kill-session", "-t", `=${name}`]);
}

export async function captureTmux(name: string): Promise<Run> {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  return run("tmux", ["capture-pane", "-p", "-e", "-t", `=${name}:`]);
}

/**
 * argv for typing `text` into the session's pane, then Enter (contract §3
 * fallback). Single-line text uses `send-keys -l`; multi-line text goes
 * through a named buffer pasted with bracketed paste (`-p`), so embedded
 * newlines do not submit early. Never a shell string.
 */
export function sendKeysPlan(name: string, text: string): string[][] {
  if (!isTmuxName(name)) throw new Error("invalid tmux name");
  // CRLF from a client is just a newline; any other control character is refused.
  text = text.replace(/\r\n/g, "\n");
  if (hasControlChars(text)) throw new Error("text contains control characters");
  const target = `=${name}:`;
  const enter = ["send-keys", "-t", target, "Enter"];
  if (!/[\r\n]/.test(text)) return [["send-keys", "-t", target, "-l", "--", text], enter];
  const buf = `hq-msg-${name}`;
  return [
    ["set-buffer", "-b", buf, "--", text],
    ["paste-buffer", "-p", "-d", "-b", buf, "-t", target],
    enter,
  ];
}

/** Runs tmux steps in order, stopping at the first failure. */
async function runSteps(steps: string[][], pauseBeforeEnter: boolean): Promise<Run> {
  let last: Run = { ok: true, stdout: "", stderr: "" };
  for (const [i, args] of steps.entries()) {
    // Give the TUI a beat to take the text before Enter submits it.
    if (pauseBeforeEnter && i > 0 && i === steps.length - 1) await new Promise((r) => setTimeout(r, 150));
    last = await run("tmux", args);
    if (!last.ok) return last;
  }
  return last;
}

export async function sendKeys(name: string, text: string): Promise<Run> {
  return runSteps(sendKeysPlan(name, text), true);
}

/** Pane text for state detection; null when the pane cannot be read. */
export async function capturePlain(name: string): Promise<string | null> {
  if (!isTmuxName(name)) return null;
  const r = await run("tmux", ["capture-pane", "-p", "-J", "-t", `=${name}:`]); // -J: a wrapped banner stays one line
  return r.ok ? r.stdout : null;
}

/**
 * The only keys the terminal drawer may send, mapped to tmux key names.
 * Named keys go without -l (tmux resolves the name); characters go with -l so
 * tmux never reads them as a key name or option.
 */
export const KEY_ALLOW: Record<string, { key: string } | { literal: string }> = {
  Enter: { key: "Enter" },
  Esc: { key: "Escape" },
  Up: { key: "Up" },
  Down: { key: "Down" },
  Tab: { key: "Tab" },
  "1": { literal: "1" },
  "2": { literal: "2" },
  "3": { literal: "3" },
  y: { literal: "y" },
  n: { literal: "n" },
};

export const MAX_KEYS = 8;
export const MAX_TYPED = 2000;


/** Validates a POST /api/sessions/:name/keys body into tmux argv steps. */
export function keysPlan(name: string, body: Record<string, unknown>): { ok: true; steps: string[][] } | { ok: false; error: string } {
  if (!isTmuxName(name)) return { ok: false, error: "invalid session" };
  const target = `=${name}:`;
  if (body.keys !== undefined) {
    const keys = body.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_KEYS) {
      return { ok: false, error: `keys: 1-${MAX_KEYS} names` };
    }
    const steps: string[][] = [];
    for (const k of keys) {
      if (typeof k !== "string" || !Object.hasOwn(KEY_ALLOW, k)) {
        return { ok: false, error: `key not allowed: ${String(k).slice(0, 20)}` };
      }
      const m = KEY_ALLOW[k];
      steps.push("key" in m ? ["send-keys", "-t", target, m.key] : ["send-keys", "-t", target, "-l", "--", m.literal]);
    }
    return { ok: true, steps };
  }
  if (typeof body.text !== "string") return { ok: false, error: "send keys or text" };
  if (body.enter !== undefined && typeof body.enter !== "boolean") return { ok: false, error: "enter must be a boolean" };
  const text = body.text;
  if (!text || text.length > MAX_TYPED) return { ok: false, error: `text: 1-${MAX_TYPED} chars` };
  // Control characters would act as keys (Ctrl-C, Esc sequences, newlines): refuse them.
  if (/[\x00-\x1f\x7f-\x9f]/.test(text)) return { ok: false, error: "text must be one line without control characters" };
  const steps = [["send-keys", "-t", target, "-l", "--", text]];
  if (body.enter === true) steps.push(["send-keys", "-t", target, "Enter"]);
  return { ok: true, steps };
}

export async function sendKeysRaw(steps: string[][]): Promise<Run> {
  return runSteps(steps, true);
}
