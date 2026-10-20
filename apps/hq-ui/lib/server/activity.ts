// "Nhật ký": what a room did, from the tail of its transcript (local file only): a Claude Code session's,
// or an omp room's (`8sync ls` `transcript`). One event per typed prompt, reply text, tool call (with its
// result) and subagent start, newest last. Commands are never shown: a shell call shows its
// description / intent, else only the program name.
import fs from "node:fs";
import { maskSecrets } from "../mask";
import { claudeDir, transcriptOf } from "./ask";

const TAIL_BYTES = 1024 * 1024;
const TEXT_MAX = 400;
const PROMPT_MAX = 200;
const ERROR_MAX = 200;

export type ActivityEvent = {
  /** prompt: the owner (or a channel) typed · text: the agent's reply · tool: a tool call · agent: a subagent started. */
  kind: "prompt" | "text" | "tool" | "agent";
  /** ms; null when the line has no timestamp. */
  at: number | null;
  text: string;
  /** Tool name (tool) or subagent type (agent). */
  tool?: string;
  /** Tool calls only: pending until its result line, then ok or error (with the first 200 chars of the error). */
  status?: "pending" | "ok" | "error";
  error?: string;
};

type Block = { type?: string; text?: unknown; id?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; is_error?: unknown; content?: unknown };

const SHELLS = new Set(["Bash", "PowerShell", "BashOutput"]);
/**
 * Every text the log shows: secrets masked first (a reply or an error may quote one), then one line
 * of at most `n`. Only the shown part plus 256 chars is masked: a secret across the cut is still whole
 * in it, and a 300 KB block (one long word made the masker's regexes crawl for 76 s) costs nothing.
 */
const clip = (s: string, n: number) => {
  const t = maskSecrets(s.slice(0, n + 256)).replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function host(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

/**
 * Program name of a command line (`git`, `pnpm`): leading `VAR=value` assignments, path and quotes
 * dropped, never its arguments. Anything that does not look like a program name shows as "lệnh".
 */
function program(cmd: string): string {
  const first = cmd.trim().split(/\s+/).find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? "";
  const name = first.replace(/^["'&]+|["']+$/g, "").split(/[/\\]/).pop() ?? "";
  return /^[A-Za-z0-9._+-]{1,40}$/.test(name) ? name : "lệnh";
}

/** What a tool call is about, safe to show: its description, a file, a URL host; for a shell only the description or program. */
export function toolSummary(name: string, input: unknown): string {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const desc = str(i.description);
  if (SHELLS.has(name)) return clip(desc ?? (str(i.command) ? program(i.command as string) : ""), 160);
  const file = str(i.file_path) ?? str(i.notebook_path) ?? str(i.path);
  const url = str(i.url);
  return clip(desc ?? file ?? (url ? (host(url) ?? "") : "") ?? "", 160);
}

function blockText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((b) => (b && typeof b === "object" && typeof (b as Block).text === "string" ? ((b as Block).text as string) : "")).join(" ");
  return "";
}

/** Transcript JSONL lines → events (oldest first, at most `limit`). Unparsable and meta lines are skipped. */
export function activityFrom(lines: string[], limit = 80): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const byId = new Map<string, ActivityEvent>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: { type?: string; isMeta?: boolean; timestamp?: unknown; message?: { content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!o || o.isMeta || (o.type !== "user" && o.type !== "assistant")) continue;
    const t = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    const at = Number.isFinite(t) ? t : null;
    const content = o.message?.content;
    if (o.type === "user") {
      if (typeof content === "string") {
        // Slash-command echoes and hook output are wrapped in tags; only typed text is a prompt.
        if (!content.trimStart().startsWith("<") && content.trim()) out.push({ kind: "prompt", at, text: clip(content, PROMPT_MAX) });
        continue;
      }
      if (!Array.isArray(content)) continue;
      for (const b of content as Block[]) {
        if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
          const ev = byId.get(b.tool_use_id);
          if (!ev) continue;
          ev.status = b.is_error ? "error" : "ok";
          if (b.is_error) ev.error = clip(blockText(b.content), ERROR_MAX);
        } else if (b?.type === "text" && typeof b.text === "string" && b.text.trim() && !b.text.trimStart().startsWith("<")) {
          out.push({ kind: "prompt", at, text: clip(b.text, PROMPT_MAX) });
        }
      }
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content as Block[]) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        out.push({ kind: "text", at, text: clip(b.text, TEXT_MAX) });
      } else if (b?.type === "tool_use" && typeof b.name === "string") {
        const input = (b.input ?? {}) as Record<string, unknown>;
        const agent = (b.name === "Agent" || b.name === "Task") && str(input.subagent_type);
        const ev: ActivityEvent = agent
          ? { kind: "agent", at, tool: agent, text: clip(str(input.description) ?? "", 160), status: "pending" }
          : { kind: "tool", at, tool: b.name, text: toolSummary(b.name, input), status: "pending" };
        out.push(ev);
        if (typeof b.id === "string") byId.set(b.id, ev);
      }
    }
  }
  return out.slice(-limit);
}

/** omp tools that run code: like a shell, only their intent (or for `bash` the program) is shown. */
const OMP_CODE = new Set(["bash", "eval", "python", "ssh"]);

type OmpBlock = { type?: string; text?: unknown; id?: unknown; name?: unknown; arguments?: unknown; intent?: unknown };

/** What an omp tool call is about: its intent, else a file, a URL host; code tools never show their code. */
export function ompToolSummary(name: string, args: unknown, intent: unknown): string {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const why = str(intent) ?? str(a.i) ?? str(a.description) ?? str(a.title);
  if (OMP_CODE.has(name)) return clip(why ?? (name === "bash" && str(a.command) ? program(a.command as string) : ""), 160);
  const file = str(a.path) ?? str(a.file_path);
  const url = str(a.url);
  return clip(why ?? file ?? (url ? (host(url) ?? "") : "") ?? "", 160);
}

/**
 * omp session JSONL lines → events (oldest first, at most `limit`). Only `message` lines count: user
 * text (not `<system-reminder>`-style injections), assistant text and `toolCall` blocks (`task` = subagents),
 * `toolResult` closing its call by `toolCallId`. Thinking, custom, developer and bookkeeping lines are skipped.
 */
export function ompActivityFrom(lines: string[], limit = 80): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const byId = new Map<string, ActivityEvent>();
  for (const line of lines) {
    if (!line.trim()) continue;
    let o: { type?: string; timestamp?: unknown; message?: { role?: string; content?: unknown; toolCallId?: unknown; isError?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const m = o?.type === "message" ? o.message : null;
    if (!m) continue;
    const t = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    const at = Number.isFinite(t) ? t : null;
    if (m.role === "toolResult") {
      const ev = typeof m.toolCallId === "string" ? byId.get(m.toolCallId) : undefined;
      if (!ev) continue;
      ev.status = m.isError === true ? "error" : "ok";
      if (m.isError === true) ev.error = clip(blockText(m.content), ERROR_MAX);
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    if (m.role === "user") {
      const text = blockText(m.content);
      if (text.trim() && !text.trimStart().startsWith("<")) out.push({ kind: "prompt", at, text: clip(text, PROMPT_MAX) });
      continue;
    }
    if (m.role !== "assistant") continue;
    for (const b of m.content as OmpBlock[]) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) {
        out.push({ kind: "text", at, text: clip(b.text, TEXT_MAX) });
      } else if (b?.type === "toolCall" && typeof b.name === "string") {
        const args = (b.arguments && typeof b.arguments === "object" ? b.arguments : {}) as Record<string, unknown>;
        const first = Array.isArray(args.tasks) ? (args.tasks[0] as Record<string, unknown> | undefined) : undefined;
        const ev: ActivityEvent =
          b.name === "task"
            ? { kind: "agent", at, tool: str(args.agent) ?? str(first?.agent) ?? "task", text: clip(str(b.intent) ?? str(args.i) ?? "", 160), status: "pending" }
            : { kind: "tool", at, tool: b.name, text: ompToolSummary(b.name, args, b.intent), status: "pending" };
        out.push(ev);
        if (typeof b.id === "string") byId.set(b.id, ev);
      }
    }
  }
  return out.slice(-limit);
}

const cache = new Map<string, { size: number; mtime: number; limit: number; events: ActivityEvent[] }>();

/** The last `limit` events of a transcript file (its last 1 MB), cached by size and mtime; [] when unreadable. */
function readTail(f: string, limit: number, parse: (lines: string[], limit: number) => ActivityEvent[]): ActivityEvent[] {
  let st: fs.Stats;
  try {
    st = fs.statSync(f);
  } catch {
    return [];
  }
  const hit = cache.get(f);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs && hit.limit === limit) return hit.events;
  const start = Math.max(0, st.size - TAIL_BYTES);
  let body = "";
  let fd: number | null = null;
  try {
    fd = fs.openSync(f, "r");
    const buf = Buffer.alloc(st.size - start);
    // The session may be writing: use what was read.
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    body = buf.subarray(0, n).toString("utf8");
  } catch {
    return [];
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
  const lines = body.split("\n");
  // A tail read starts mid-line: drop that first partial line.
  const events = parse(start > 0 ? lines.slice(1) : lines, limit);
  cache.set(f, { size: st.size, mtime: st.mtimeMs, limit, events });
  return events;
}

/** The last `limit` events of a Claude Code session; [] when its transcript is not found. Never throws. */
export function readActivity(sessionId: string, cwd: string | null, limit = 80, root = claudeDir()): ActivityEvent[] {
  const f = transcriptOf(sessionId, cwd, root);
  return f ? readTail(f, limit, activityFrom) : [];
}

/** The last `limit` events of an omp room's transcript file (path from `8sync ls`, never a client). Never throws. */
export function readOmpActivity(file: string, limit = 80): ActivityEvent[] {
  return readTail(file, limit, ompActivityFrom);
}
