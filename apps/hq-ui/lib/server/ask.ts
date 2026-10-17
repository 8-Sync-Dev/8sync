// Reads the tail of a session's Claude Code transcript to show what it is asking the owner
// (lib/ask.ts). Only called for sessions `claude agents` reports as waiting. Local files only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pendingAsk, type Ask } from "../ask";

/** The pending call is at the end; 512 KB holds many turns even with large tool results. */
const TAIL_BYTES = 512 * 1024;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

/** Claude Code's folder name for a project: every character but A–Z, a–z, 0–9 becomes "-". */
export const projectDirName = (cwd: string) => cwd.replace(/[^A-Za-z0-9]/g, "-");

const found = new Map<string, string>();

/** `<claude dir>/projects/<project>/<id>.jsonl`: the cwd's folder first, else any project (a room may have moved into a worktree). */
export function transcriptOf(sessionId: string, cwd: string | null, root = claudeDir()): string | null {
  if (!SESSION_ID.test(sessionId)) return null;
  const known = found.get(sessionId);
  if (known && fs.existsSync(known)) return known;
  const projects = path.join(root, "projects");
  const name = `${sessionId}.jsonl`;
  const guess = cwd ? path.join(projects, projectDirName(cwd), name) : null;
  let hit = guess && fs.existsSync(guess) ? guess : null;
  if (!hit) {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(projects);
    } catch {
      return null;
    }
    hit = dirs.map((d) => path.join(projects, d, name)).find((f) => fs.existsSync(f)) ?? null;
  }
  if (hit) found.set(sessionId, hit);
  return hit;
}

const cache = new Map<string, { size: number; mtime: number; ask: Ask | null }>();

export function readAsk(sessionId: string, cwd: string | null, root = claudeDir()): Ask | null {
  const f = transcriptOf(sessionId, cwd, root);
  if (!f) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(f);
  } catch {
    return null;
  }
  const hit = cache.get(f);
  if (hit && hit.size === st.size && hit.mtime === st.mtimeMs) return hit.ask;
  const start = Math.max(0, st.size - TAIL_BYTES);
  let body = "";
  let fd: number | null = null;
  try {
    fd = fs.openSync(f, "r");
    const buf = Buffer.alloc(st.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    body = buf.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
  const lines = body.split("\n");
  const ask = pendingAsk(start > 0 ? lines.slice(1) : lines);
  cache.set(f, { size: st.size, mtime: st.mtimeMs, ask });
  return ask;
}
