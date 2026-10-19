// Web terminal of a background room: `8sync ccc term <id>` runs `claude attach <id>` in a
// pseudo-terminal (crates/cli/src/verbs/ccc/term.rs) and relays it over stdin/stdout, so this
// server stays pure JS. One bridge per room, shared by every tab looking at it; its recent output
// is kept so a tab that opens late sees the screen. Closed 60 s after the last viewer leaves,
// which stops only the attach client: the room keeps running.
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { binFor, childEnv } from "./child-env";

export const TERM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEEP_BYTES = 256 * 1024;
export const IDLE_CLOSE_MS = 60_000;
const MAX_INPUT = 4096;

type Spawn = (cmd: string, args: string[], opts: { cwd?: string; windowsHide: boolean; env?: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;
type Term = { proc: ChildProcessWithoutNullStreams; chunks: Buffer[]; bytes: number; viewers: Set<(b: Buffer | null) => void>; idle?: ReturnType<typeof setTimeout>; ended: boolean };

const terms = new Map<string, Term>();

export const termArgs = (id: string, cols: number, rows: number) => ["ccc", "term", id, "--cols", String(cols), "--rows", String(rows)];

/** Terminal size from the browser, clamped to what the bridge accepts. */
export function clampSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const n = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
  return { cols: n(cols, 2, 500, 120), rows: n(rows, 2, 300, 34) };
}

function send(t: Term, line: object) {
  if (!t.ended) t.proc.stdin.write(`${JSON.stringify(line)}\n`);
}

/** The room's bridge, started on first use. */
export function openTerm(id: string, cwd: string | null, size: { cols: number; rows: number }, spawn: Spawn = nodeSpawn as unknown as Spawn): Term {
  if (!TERM_ID.test(id)) throw new Error("bad session id");
  const cur = terms.get(id);
  if (cur && !cur.ended) return cur;
  const proc = spawn(binFor("8sync"), termArgs(id, size.cols, size.rows), { cwd: cwd ?? undefined, windowsHide: true, env: childEnv() });
  const t: Term = { proc, chunks: [], bytes: 0, viewers: new Set(), ended: false };
  terms.set(id, t);
  proc.stdout.on("data", (b: Buffer) => {
    t.chunks.push(b);
    t.bytes += b.length;
    while (t.bytes > KEEP_BYTES && t.chunks.length > 1) t.bytes -= t.chunks.shift()!.length;
    for (const v of t.viewers) v(b);
  });
  const end = () => {
    if (t.ended) return;
    t.ended = true;
    if (terms.get(id) === t) terms.delete(id);
    for (const v of t.viewers) v(null);
  };
  proc.on("exit", end);
  proc.on("error", end);
  return t;
}

/** Replays what the terminal showed so far, then streams; `null` means the terminal closed. */
export function watch(id: string, t: Term, fn: (b: Buffer | null) => void): () => void {
  clearTimeout(t.idle);
  if (t.chunks.length) fn(Buffer.concat(t.chunks));
  if (t.ended) fn(null);
  t.viewers.add(fn);
  return () => {
    t.viewers.delete(fn);
    if (t.viewers.size === 0) t.idle = setTimeout(() => closeTerm(id), IDLE_CLOSE_MS);
  };
}

/** Keys typed in the browser (xterm's onData), or a new size. */
export function input(id: string, x: { data?: unknown; cols?: unknown; rows?: unknown }): boolean {
  const t = terms.get(id);
  if (!t || t.ended) return false;
  if (typeof x.data === "string" && x.data.length > 0 && x.data.length <= MAX_INPUT) send(t, { i: x.data });
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
