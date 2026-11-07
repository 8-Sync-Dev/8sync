// The `task` subagents of an omp transcript, read from disk. omp writes each one next to the parent
// transcript, in the folder named like it (`<ts>_<uuid>/<Agent>.jsonl`), and its final answer as
// `<Agent>.md` when it ends. Used by the sidebar tree (omp-tree.ts) and by the floor (floor.ts), where a
// room whose own turn ended but whose background subagents still run shows as working, not idle.
// Tested in tests/session-tree.test.ts and tests/floor.test.ts.
import fs from "node:fs";
import path from "node:path";
import type { TreeChild } from "../session-tree";

/** A subagent whose transcript moved this recently and that has no result yet is still working. */
const CHILD_LIVE_MS = 90_000;
/** A subagent sitting in one tool call (a long bash, `wait`, a recording) for longer than this is dead. */
const TOOL_LIVE_MS = 6 * 3600_000;
const CHILDREN_MAX = 40;
/** How far back to look for the start of the last transcript line (a tool call can carry a large argument). */
const TAIL_SCAN_MAX = 4 * 1024 * 1024;
const CHUNK = 64 * 1024;

function firstLine(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const line = buf
      .toString("utf8", 0, n)
      .split(/\r?\n/)
      .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
      .find(Boolean);
    return line ? (line.length > 140 ? `${line.slice(0, 139)}…` : line) : null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** The first `n` bytes of the last non-empty line of `file`, or null (unreadable, or a line over 4 MB). */
export function lastLineHead(file: string, n = 256): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    let end = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(CHUNK);
    // Skip the trailing newline(s) so "last line" means the last entry.
    while (end > 0) {
      const at = Math.max(0, end - 1);
      fs.readSync(fd, buf, 0, 1, at);
      if (buf[0] !== 0x0a && buf[0] !== 0x0d) break;
      end = at;
    }
    if (end === 0) return null;
    let start = -1;
    let pos = end;
    while (pos > 0 && end - pos < TAIL_SCAN_MAX) {
      const from = Math.max(0, pos - CHUNK);
      const len = pos - from;
      fs.readSync(fd, buf, 0, len, from);
      const nl = buf.subarray(0, len).lastIndexOf(0x0a);
      if (nl >= 0) {
        start = from + nl + 1;
        break;
      }
      pos = from;
    }
    if (start < 0) {
      if (pos > 0) return null; // the last line is longer than TAIL_SCAN_MAX
      start = 0;
    }
    const len = Math.min(n, end - start);
    const head = Buffer.alloc(len);
    fs.readSync(fd, head, 0, len, start);
    return head.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** omp logs `tool_execution_start` before a tool runs and the tool's result after: ending on the start means a tool is running. */
const inTool = (file: string) => lastLineHead(file)?.includes('"customType":"tool_execution_start"') ?? false;

/**
 * Every subagent of `transcript`. Result → Xong; an empty result → Lỗi (it ended without answering); no
 * result and either a transcript that moved in the last 90 s or, while the room's process is `live`, a
 * tool call still running (under 6 h) → Đang làm; else nghỉ (stopped). Running first, then newest; at most 40.
 */
export function ompChildren(transcript: string, parentId: string, now = Date.now(), live = true): TreeChild[] {
  const dir = transcript.replace(/\.jsonl$/, "");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const out: TreeChild[] = [];
  for (const f of names) {
    const agent = f.slice(0, -".jsonl".length);
    const file = path.join(dir, f);
    let at: number;
    try {
      at = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    const md = path.join(dir, `${agent}.md`);
    let size: number | null = null;
    try {
      size = fs.statSync(md).size;
    } catch {
      size = null;
    }
    const age = now - at;
    const running = size === null && (age <= CHILD_LIVE_MS || (live && age <= TOOL_LIVE_MS && inTool(file)));
    const state = running ? "working" : size === null ? "idle" : size > 0 ? "done" : "error";
    const detail = size ? firstLine(md) : size === 0 ? "Kết thúc mà không có kết quả" : null;
    out.push({ key: `${parentId}/${agent}`, title: agent, state, at: Math.round(at), detail });
  }
  return out.sort((a, b) => Number(b.state === "working") - Number(a.state === "working") || (b.at ?? 0) - (a.at ?? 0)).slice(0, CHILDREN_MAX);
}

/** Names of the subagents still running, without omp's own sidecars (`__advisor`). */
export function runningChildren(transcript: string, now = Date.now()): string[] {
  return ompChildren(transcript, "", now, true)
    .filter((c) => c.state === "working" && !c.title.startsWith("__"))
    .map((c) => c.title);
}
