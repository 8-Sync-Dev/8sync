// Web terminals: a background room (`8sync ccc term <id>` runs `claude attach <id>`) or the owner's
// shell (`8sync ccc term --shell`), each in a pseudo-terminal (crates/cli/src/verbs/ccc/term.rs)
// relayed over stdin/stdout, so this server stays pure JS. One bridge per room (and one shell),
// shared by every tab looking at it; its recent output is kept so a tab that opens late sees the
// screen. A room's bridge closes 60 s after the last viewer leaves (only the attach client stops:
// the room keeps running); the shell lives 30 min without a viewer, then exits.
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { binFor, childEnv } from "./child-env";

export const TERM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Bridge key of the owner's shell (never a session id). */
export const SHELL_KEY = "shell";
const KEEP_BYTES = 256 * 1024;
export const IDLE_CLOSE_MS = 60_000;
export const SHELL_IDLE_MS = 30 * 60_000;
const MAX_INPUT = 4096;

type Spawn = (cmd: string, args: string[], opts: { cwd?: string; windowsHide: boolean; env?: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;
/** `typed`: the bridge has had input, so the queries in its kept output (ConPTY's opening `ESC[6n`, DA…) were answered. */
export type Term = { proc: ChildProcessWithoutNullStreams; gen: number; chunks: Buffer[]; bytes: number; total: number; viewers: Set<(b: Buffer | null, answered?: boolean) => void>; idle?: ReturnType<typeof setTimeout>; idleMs: number; typed: boolean; ended: boolean };

const terms = new Map<string, Term>();
let gens = 0;

export const termArgs = (id: string, cols: number, rows: number) => ["ccc", "term", id, "--cols", String(cols), "--rows", String(rows)];
export const shellArgs = (cols: number, rows: number) => ["ccc", "term", "--shell", "--cols", String(cols), "--rows", String(rows)];

/** Terminal size from the browser, clamped to what the bridge accepts. */
export function clampSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { cols: n(cols, 2, 500, 120), rows: n(rows, 2, 300, 34) };
}

function send(t: Term, line: object) {
  if (!t.ended) t.proc.stdin.write(`${JSON.stringify(line)}\n`);
}

function start(key: string, args: string[], cwd: string | null, idleMs: number, spawn: Spawn): Term {
  const cur = terms.get(key);
  if (cur && !cur.ended) return cur;
  const proc = spawn(binFor("8sync"), args, { cwd: cwd ?? undefined, windowsHide: true, env: childEnv() });
  const t: Term = { proc, gen: ++gens, chunks: [], bytes: 0, total: 0, viewers: new Set(), idleMs, typed: false, ended: false };
  terms.set(key, t);
  proc.stdout.on("data", (b: Buffer) => {
    t.chunks.push(b);
    t.bytes += b.length;
    t.total += b.length;
    while (t.bytes > KEEP_BYTES && t.chunks.length > 1) t.bytes -= t.chunks.shift()!.length;
    for (const v of t.viewers) v(b);
  });
  const end = () => {
    if (t.ended) return;
    t.ended = true;
    clearTimeout(t.idle);
    if (terms.get(key) === t) terms.delete(key);
    for (const v of t.viewers) v(null);
  };
  proc.on("exit", end);
  proc.on("error", end);
  return t;
}

/** The room's bridge, started on first use. */
export function openTerm(id: string, cwd: string | null, size: { cols: number; rows: number }, spawn: Spawn = nodeSpawn as unknown as Spawn): Term {
  if (!TERM_ID.test(id)) throw new Error("bad session id");
  return start(id, termArgs(id, size.cols, size.rows), cwd, IDLE_CLOSE_MS, spawn);
}

/** The owner's shell, started in `cwd` on first use; later opens join the running one. */
export function openShell(cwd: string | null, size: { cols: number; rows: number }, spawn: Spawn = nodeSpawn as unknown as Spawn): Term {
  return start(SHELL_KEY, shellArgs(size.cols, size.rows), cwd, SHELL_IDLE_MS, spawn);
}

/**
 * Replays what the terminal showed so far, then streams; `null` means the terminal closed. The replay
 * comes with `answered` = the bridge has had input: its queries were answered already, so a terminal
 * that answers them again would type junk (`;5R` at a prompt, `R` in vim).
 */
export function watch(id: string, t: Term, fn: (b: Buffer | null, answered?: boolean) => void): () => void {
  clearTimeout(t.idle);
  if (t.chunks.length) fn(Buffer.concat(t.chunks), t.typed);
  if (t.ended) fn(null);
  t.viewers.add(fn);
  return () => {
    t.viewers.delete(fn);
    if (t.viewers.size === 0 && !t.ended) t.idle = setTimeout(() => closeTerm(id), t.idleMs);
  };
}

/** One poll: bridge `gen`, byte `cursor` to send next, `out` after the asked cursor (all kept output on `reset`); `answered` as in [watch], for a `reset` replay. */
export type TermPoll = { gen: number; cursor: number; out: Buffer; reset: boolean; answered: boolean; ended: boolean };

/**
 * The remote link's view (a Cloudflare quick tunnel holds an event stream back, so the page polls):
 * output after byte `since` of bridge `gen`. Kept output is trimmed and a new bridge starts over, so a
 * cursor this bridge cannot serve replays everything kept with `reset`. A poll keeps the bridge open
 * like a viewer that leaves now: it closes the bridge's idle time after the last poll.
 */
export function poll(id: string, t: Term, gen: number, since: number): TermPoll {
  if (!t.ended && t.viewers.size === 0) {
    clearTimeout(t.idle);
    t.idle = setTimeout(() => closeTerm(id), t.idleMs);
  }
  const first = t.total - t.bytes;
  const reset = gen !== t.gen || !Number.isInteger(since) || since < first || since > t.total;
  const all = Buffer.concat(t.chunks);
  return { gen: t.gen, cursor: t.total, out: reset ? all : all.subarray(since - first), reset, answered: reset && t.typed, ended: t.ended };
}

/** Keys typed in the browser (xterm's onData), or a new size. */
export function input(id: string, x: { data?: unknown; cols?: unknown; rows?: unknown }): boolean {
  const t = terms.get(id);
  if (!t || t.ended) return false;
  if (typeof x.data === "string" && x.data.length > 0 && x.data.length <= MAX_INPUT) {
    send(t, { i: x.data });
    t.typed = true;
  }
  if (x.cols !== undefined || x.rows !== undefined) {
    const s = clampSize(x.cols, x.rows);
    send(t, { r: [s.cols, s.rows] });
  }
  return true;
}

/** Ends the bridge (the attach client); the background room keeps running. */
export function closeTerm(id: string) {
  const t = terms.get(id);
  if (!t) return;
  clearTimeout(t.idle);
  terms.delete(id);
  try {
    t.proc.stdin.end();
  } catch {
    /* already closed */
  }
  setTimeout(() => {
    if (!t.ended) t.proc.kill();
  }, 3000).unref?.();
}

export const termOpen = (id: string) => terms.has(id);
