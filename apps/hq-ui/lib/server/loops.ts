// "Vòng lặp" panel of the Flow tab: each `/ship-loop` under `su-code/ship/<slug>/` with how many
// iterations it ran and the last evidence line of its LOOP.md (crates/cli/src/verbs/ccc/looper.rs
// appends "iter N | <check> | exit X | <tail>"). LOOP.md is hand-written too, so parsing is lenient:
// a file we cannot read is skipped, never an error for the whole list.
import fs from "node:fs";
import path from "node:path";
import type { ProjectInfo } from "../office";
import { mainRoot } from "../preview";

const LOOPS_MAX = 12;
const DIRS_MAX = 300;
const READ_MAX = 256 * 1024;

export type LoopRow = {
  slug: string;
  /** Iterations: loop.json `iter`, else the highest "iter N" in the evidence. */
  iter: number | null;
  maxIter: number | null;
  /** loop.json `stopped` (max-iter, stuck, done…); null = running or unknown. */
  stopped: string | null;
  running: boolean;
  /** Last evidence line, as written (trimmed, at most 300 chars). */
  last: string | null;
  /** When LOOP.md last changed (ms). */
  at: number;
};

export type ProjectLoops = { root: string; name: string; loops: LoopRow[] };

/** The evidence lines of a LOOP.md: under "## Evidence" when that heading exists, else every "iter N |" line. */
export function parseLoopMd(md: string): { last: string | null; iter: number | null } {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const head = lines.findIndex((l) => /^#{1,6}\s*(evidence|bằng chứng)\b/i.test(l.trim()));
  let ev: string[];
  if (head >= 0) {
    const rest = lines.slice(head + 1);
    const end = rest.findIndex((l) => /^#{1,6}\s/.test(l.trim()));
    ev = (end >= 0 ? rest.slice(0, end) : rest).map((l) => l.trim()).filter((l) => l && !/^\|?\s*-{3,}/.test(l));
  } else {
    ev = lines.map((l) => l.trim()).filter((l) => /^(?:[-*]\s*)?iter\s*\d+/i.test(l));
  }
  let iter: number | null = null;
  for (const l of ev) {
    const m = /\biter\s*(\d{1,6})\b/i.exec(l);
    if (m) iter = Math.max(iter ?? 0, Number(m[1]));
  }
  const last = ev.length ? ev[ev.length - 1].replace(/^[-*]\s+/, "").slice(0, 300) : null;
  return { last, iter };
}

function readHead(file: string): string | null {
  try {
    const fd = fs.openSync(file, "r");
    try {
      const size = fs.fstatSync(fd).size;
      // The tail holds the latest evidence; a huge log is read from its last 256 KB.
      const start = Math.max(0, size - READ_MAX);
      const buf = Buffer.alloc(Math.min(size, READ_MAX));
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** One project's loops, most recently touched first. Never throws. */
export function readProjectLoops(root: string): LoopRow[] {
  const ship = path.join(root, "su-code", "ship");
  let dirs: fs.Dirent[] = [];
  try {
    dirs = fs.readdirSync(ship, { withFileTypes: true }).filter((d) => d.isDirectory()).slice(0, DIRS_MAX);
  } catch {
    return [];
  }
  const rows: LoopRow[] = [];
  for (const d of dirs) {
    const md = path.join(ship, d.name, "LOOP.md");
    let at = 0;
    try {
      at = Math.round(fs.statSync(md).mtimeMs);
    } catch {
      continue;
    }
    const text = readHead(md);
    if (text === null) continue;
    const { last, iter } = parseLoopMd(text);
    let state: Record<string, unknown> | null = null;
    try {
      state = JSON.parse(fs.readFileSync(path.join(ship, d.name, "loop.json"), "utf8"));
    } catch {
      /* LOOP.md without loop.json: an old or hand-run loop */
    }
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const stopped = typeof state?.stopped === "string" ? state.stopped.slice(0, 80) : null;
    rows.push({
      slug: d.name,
      iter: n(state?.iter) ?? iter,
      maxIter: n(state?.max_iter),
      stopped,
      running: state != null && stopped == null,
      last,
      at,
    });
  }
  return rows.sort((a, b) => Number(b.running) - Number(a.running) || b.at - a.at).slice(0, LOOPS_MAX);
}

export function listLoops(projects: ProjectInfo[]): ProjectLoops[] {
  const seen = new Map<string, ProjectLoops>();
  for (const p of projects) {
    const root = mainRoot(p.root);
    const k = root.toLowerCase();
    if (!seen.has(k)) seen.set(k, { root, name: path.basename(root) || p.name, loops: readProjectLoops(root) });
  }
  return [...seen.values()];
}
