// The "Hạn mức" page: plan windows from the 8sync status-line snapshots (same files as the header
// meter, lib/server/office.ts readLimits) and tokens from the local Claude Code transcripts of the HQ
// projects. Local files only: no credentials, no Anthropic usage API.
//
// `8sync ccc report --json` is not reused: its `tokens` is one context number per live session
// (from `8sync ls`), with no input / cache / output split and nothing about ended rooms.
import fs from "node:fs";
import { open as openFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { sessionLabel } from "../labels";
import type { Limits, ProjectInfo } from "../office";
import { claudeDir, projectDirName } from "./ask";
import { projectOf } from "./office";
import { stateDir } from "./paths";

const HOUR = 3_600_000;
export const FIVE_HOURS = 5 * HOUR;
/** Rooms rest at this share of a plan window (Room docs, `ccc auto` pause). */
export const REST_PCT = 90;
/** Team rooms auto-compact around here since 0.105.0: a median context above it costs tokens on every call. */
export const CONTEXT_CAP = 195_000;
/**
 * Bytes of transcript read per request at most; the rest is read by the next polls (the page asks again
 * every 1.5 s while `pending_bytes` > 0). Reads are async and 1 MB at a time, so other routes keep answering.
 */
export const BYTES_PER_REQUEST = 8 * 1024 * 1024;
const CHUNK = 1024 * 1024;
/** One JSON line longer than this is skipped (an assistant line with usage is never near it). */
const MAX_LINE = 8 * 1024 * 1024;
/** Sessions touched within this span count as HQ rooms whose project is scanned. */
const RECENT_SESSIONS = 48 * HOUR;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One deduped API call (assistant message id) as the transcript recorded it. */
export type Call = { ts: number; input: number; cache_read: number; cache_write: number; output: number };

export type Tokens = {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  /** Deduped API calls. */
  calls: number;
  /** Median of input + cache read + cache write per call: what the model re-reads each turn. */
  median_ctx: number | null;
};

export type UsageRow = {
  /** Same identity as Office `Room.key`: the hq-* name when the session runs in one, else the session id. */
  key: string;
  session_id: string;
  label: string;
  project: ProjectInfo | null;
  model: string | null;
  today: Tokens;
  window: Tokens;
  /** Last call (unix ms). */
  last_at: number | null;
};

export type LimitSource = Limits & { session_id: string | null; project: string | null; model: string | null };

export type UsageReport = {
  at: number;
  /** Local midnight of the machine running HQ (unix ms). */
  day_start: number;
  /** Start of the current 5-hour plan window: `five_hour_resets_at` − 5 h, else now − 5 h. */
  window_start: number;
  limits: LimitSource | null;
  rows: UsageRow[];
  totals: { today: Tokens; window: Tokens };
  scan: { files: number; read_bytes: number; pending_bytes: number; ms: number };
  rest_pct: number;
  context_cap: number;
};

// ---------- plan windows ----------

/**
 * The freshest status-line snapshot carrying plan limits, with the session it came from. Same rule
 * as the header meter (readLimits): newest 5 files by mtime, first one with a window percentage.
 */
export function readLimitSource(): LimitSource | null {
  const dir = path.join(stateDir(), "usage");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && SAFE_ID.test(n.slice(0, -5)));
  } catch {
    return null;
  }
  const files = names
    .flatMap((n) => {
      try {
        return [{ f: path.join(dir, n), at: fs.statSync(path.join(dir, n)).mtimeMs }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const s = (x: unknown) => (typeof x === "string" && x ? x : null);
  for (const { f } of files) {
    try {
      const v = JSON.parse(fs.readFileSync(f, "utf8").slice(0, 8192));
      const l: LimitSource = {
        five_hour_pct: n(v.five_hour_pct),
        five_hour_resets_at: n(v.five_hour_resets_at),
        seven_day_pct: n(v.seven_day_pct),
        seven_day_resets_at: n(v.seven_day_resets_at),
        ts: n(v.ts),
        session_id: s(v.session_id) ?? path.basename(f, ".json"),
        project: projectOf(s(v.cwd))?.name ?? s(v.cwd),
        model: s(v.model),
      };
      if (l.five_hour_pct != null || l.seven_day_pct != null) return l;
    } catch {
      /* half-written snapshot: try the next one */
    }
  }
  return null;
}

/** Local midnight before `now`. */
export function dayStart(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The current 5-hour plan window starts 5 h before its reset; with no (or a past) reset, the last 5 h. */
export function windowStart(limits: Pick<Limits, "five_hour_resets_at"> | null, now: number): number {
  const at = limits?.five_hour_resets_at;
  if (at != null && at * 1000 > now) return at * 1000 - FIVE_HOURS;
  return now - FIVE_HOURS;
}

// ---------- transcripts ----------

type FileState = {
  size: number;
  mtime: number;
  /** Next byte to read (always a line start). */
  offset: number;
  /** Inside a line longer than MAX_LINE: drop bytes up to the next newline. */
  skipping: boolean;
  session_id: string;
  cwd: string | null;
  model: string | null;
  calls: Map<string, Call>;
};

/** `tail`: the last queued scan; the next one starts after it. */
type Cache = { files: Map<string, FileState>; tail: Promise<void> };
const g = globalThis as unknown as { __hqUsage?: Cache };

/** Test hook: forget every file offset. */
export function resetUsageCache(): void {
  g.__hqUsage = { files: new Map(), tail: Promise.resolve() };
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : 0);

/** One transcript line → a call (assistant line with usage) plus the cwd/model it names; anything else null. */
export function parseLine(line: string): { id: string; call: Call; cwd: string | null; model: string | null } | null {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let v: {
    type?: string;
    timestamp?: string;
    cwd?: string;
    requestId?: string;
    message?: { id?: string; model?: string; usage?: Record<string, unknown> };
  };
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  const m = v?.message;
  const u = m?.usage;
  if (v?.type !== "assistant" || !u || typeof u !== "object") return null;
  const id = typeof m.id === "string" && m.id ? m.id : typeof v.requestId === "string" ? v.requestId : null;
  const ts = typeof v.timestamp === "string" ? Date.parse(v.timestamp) : NaN;
  if (!id || !Number.isFinite(ts)) return null;
  const call: Call = {
    ts,
    input: num(u.input_tokens),
    cache_read: num(u.cache_read_input_tokens),
    cache_write: num(u.cache_creation_input_tokens),
    output: num(u.output_tokens),
  };
  if (call.input + call.cache_read + call.cache_write + call.output === 0) return null; // <synthetic>
  const model = typeof m.model === "string" && m.model !== "<synthetic>" ? m.model : null;
  return { id, call, cwd: typeof v.cwd === "string" ? v.cwd : null, model };
}

/** Claude Code writes one line per content block of a message, each repeating the usage: keep the largest. */
function keep(calls: Map<string, Call>, id: string, c: Call): void {
  const old = calls.get(id);
  if (!old) return void calls.set(id, c);
  old.ts = Math.min(old.ts, c.ts);
  old.input = Math.max(old.input, c.input);
  old.cache_read = Math.max(old.cache_read, c.cache_read);
  old.cache_write = Math.max(old.cache_write, c.cache_write);
  old.output = Math.max(old.output, c.output);
}

const TS_RE = /"timestamp":"([^"]{10,40})"/;

/** The first timestamp at or after byte `at` (on a fresh line), or null when none in the next 256 KB. */
async function tsAt(fh: FileHandle, at: number, size: number): Promise<{ ts: number; line: number } | null> {
  const buf = Buffer.alloc(Math.min(256 * 1024, size - at));
  const { bytesRead: n } = await fh.read(buf, 0, buf.length, at);
  let i = at === 0 ? 0 : buf.indexOf(10) + 1;
  if (at !== 0 && i === 0) return null;
  while (i < n) {
    const end = buf.indexOf(10, i);
    if (end < 0) return null;
    const m = TS_RE.exec(buf.toString("utf8", i, end));
    if (m) {
      const ts = Date.parse(m[1]);
      if (Number.isFinite(ts)) return { ts, line: at + i };
    }
    i = end + 1;
  }
  return null;
}

/**
 * First read of a long transcript: transcripts are chronological, so binary-search the byte offset of
 * the first line at or after `since` instead of parsing days of history. Unknown spots count as new
 * (read more, never less).
 */
export async function seekSince(fh: FileHandle, size: number, since: number): Promise<number> {
  let lo = 0;
  let hi = size;
  while (hi - lo > 1024 * 1024) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await tsAt(fh, mid, size);
    if (t && t.ts < since) lo = t.line;
    else hi = mid;
  }
  if (lo === 0) return 0;
  // `lo` is a line start whose timestamp is before `since`: parse from there (one stale line at most).
  return lo;
}

/** Read new complete lines of one file into its state, at most `budget` bytes; returns bytes consumed. */
async function readNew(f: string, st: FileState, budget: number): Promise<number> {
  let fh: FileHandle;
  try {
    fh = await openFile(f, "r");
  } catch {
    return 0;
  }
  let used = 0;
  try {
    while (st.offset < st.size && used < budget) {
      let len = Math.min(CHUNK, st.size - st.offset, budget - used);
      let buf = Buffer.alloc(len);
      let n = (await fh.read(buf, 0, len, st.offset)).bytesRead;
      let nl = buf.lastIndexOf(10, n - 1);
      // Out of budget mid-line: the next request goes on from this line start.
      if (nl < 0 && used > 0) break;
      // A line longer than the chunk: grow up to MAX_LINE, past it skip the line.
      while (nl < 0 && st.offset + n < st.size && len < MAX_LINE) {
        len = Math.min(len * 2, MAX_LINE, st.size - st.offset);
        buf = Buffer.alloc(len);
        n = (await fh.read(buf, 0, len, st.offset)).bytesRead;
        nl = buf.lastIndexOf(10, n - 1);
      }
      if (nl < 0) {
        if (st.offset + n >= st.size) break; // the last line is still being written
        st.skipping = true;
        st.offset += n;
        used += n;
        continue;
      }
      let start = 0;
      if (st.skipping) {
        start = buf.indexOf(10) + 1;
        st.skipping = false;
      }
      for (const line of buf.toString("utf8", start, nl).split("\n")) {
        const p = parseLine(line);
        if (!p) continue;
        keep(st.calls, p.id, p.call);
        if (p.cwd) st.cwd = p.cwd;
        if (p.model) st.model = p.model;
      }
      st.offset += nl + 1;
      used += nl + 1;
    }
  } finally {
    await fh.close();
  }
  return used;
}

/** Claude Code project folders of `roots` and their worktrees (`<root>/.claude/worktrees/*`, `.git/worktrees/*`). */
export function transcriptDirs(roots: string[], projects = path.join(claudeDir(), "projects")): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(projects);
  } catch {
    return [];
  }
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const root of roots) {
    const enc = projectDirName(root);
    exact.add(enc);
    // A hidden folder under the root (".claude/worktrees/x", ".worktrees/x") encodes as root + "--".
    prefixes.push(enc + "--");
    // Worktrees elsewhere: `.git/worktrees/<n>/gitdir` points at `<worktree>/.git`.
    try {
      for (const w of fs.readdirSync(path.join(root, ".git", "worktrees"))) {
        const gd = fs.readFileSync(path.join(root, ".git", "worktrees", w, "gitdir"), "utf8").trim();
        if (gd) exact.add(projectDirName(path.dirname(path.resolve(gd))));
      }
    } catch {
      /* no linked worktrees */
    }
  }
  const ex = new Set([...exact].map((s) => s.toLowerCase()));
  const pre = prefixes.map((s) => s.toLowerCase());
  return names
    .filter((n) => {
      const l = n.toLowerCase();
      return ex.has(l) || pre.some((p) => l.startsWith(p));
    })
    .map((n) => path.join(projects, n));
}

/** `<dir>/<sid>.jsonl` and `<dir>/<sid>/subagents/*.jsonl`, touched at or after `since`. */
function transcriptFiles(dir: string, since: number): { f: string; sid: string; size: number; mtime: number }[] {
  const out: { f: string; sid: string; size: number; mtime: number }[] = [];
  const add = (f: string, sid: string) => {
    try {
      const st = fs.statSync(f);
      if (st.isFile() && st.mtimeMs >= since) out.push({ f, sid, size: st.size, mtime: st.mtimeMs });
    } catch {
      /* gone between readdir and stat */
    }
  };
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    if (n.endsWith(".jsonl")) {
      const sid = n.slice(0, -6);
      if (SESSION_ID.test(sid)) add(path.join(dir, n), sid);
    } else if (SESSION_ID.test(n)) {
      const sub = path.join(dir, n, "subagents");
      let subs: string[] = [];
      try {
        subs = fs.readdirSync(sub).filter((s) => s.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const s of subs) add(path.join(sub, s), n);
    }
  }
  return out;
}

type Scan = { states: FileState[]; read_bytes: number; pending_bytes: number };

/**
 * Bring the per-file cache up to date for `dirs`, reading at most `budget` bytes (freshest files first),
 * and drop calls older than `keepFrom`. Returns the files still in scope. Scans run one at a time: two
 * overlapping requests would both read from the same offset and advance it twice.
 */
export function scanTranscripts(dirs: string[], keepFrom: number, budget = BYTES_PER_REQUEST): Promise<Scan> {
  const c = (g.__hqUsage ??= { files: new Map(), tail: Promise.resolve() });
  const run = c.tail.then(() => scanOnce(c, dirs, keepFrom, budget));
  c.tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function scanOnce(c: Cache, dirs: string[], keepFrom: number, budget: number): Promise<Scan> {
  const files = dirs.flatMap((d) => transcriptFiles(d, keepFrom)).sort((a, b) => b.mtime - a.mtime);
  const seen = new Set<string>();
  let read = 0;
  let pending = 0;
  for (const { f, sid, size, mtime } of files) {
    seen.add(f);
    let st = c.files.get(f);
    if (!st || size < st.offset) {
      // New file, or rewritten shorter: start over (from the first line on or after keepFrom).
      st = { size, mtime, offset: 0, skipping: false, session_id: sid, cwd: null, model: null, calls: new Map() };
      if (size > 2 * 1024 * 1024) {
        try {
          const fh = await openFile(f, "r");
          try {
            st.offset = await seekSince(fh, size, keepFrom);
          } finally {
            await fh.close();
          }
        } catch {
          /* unreadable now: try from 0 next time */
        }
      }
      c.files.set(f, st);
    }
    st.size = size;
    st.mtime = mtime;
    if (st.offset < size && read < budget) read += await readNew(f, st, budget - read);
    pending += Math.max(0, st.size - st.offset);
    for (const [id, call] of st.calls) if (call.ts < keepFrom) st.calls.delete(id);
  }
  // Files out of scope (old, removed, other project): forget them.
  for (const f of [...c.files.keys()]) if (!seen.has(f)) c.files.delete(f);
  return { states: files.map((x) => c.files.get(x.f)!).filter(Boolean), read_bytes: read, pending_bytes: pending };
}

// ---------- totals ----------

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Sum calls at or after `from`; median context per call. */
export function sumCalls(calls: Iterable<Call>, from: number): Tokens {
  const t: Tokens = { input: 0, cache_read: 0, cache_write: 0, output: 0, calls: 0, median_ctx: null };
  const ctx: number[] = [];
  for (const c of calls) {
    if (c.ts < from) continue;
    t.input += c.input;
    t.cache_read += c.cache_read;
    t.cache_write += c.cache_write;
    t.output += c.output;
    t.calls++;
    ctx.push(c.input + c.cache_read + c.cache_write);
  }
  t.median_ctx = median(ctx);
  return t;
}

export const totalTokens = (t: Pick<Tokens, "input" | "cache_read" | "cache_write" | "output">) =>
  t.input + t.cache_read + t.cache_write + t.output;

type Names = { alias: Map<string, string>; names: Map<string, string> };

/**
 * Per-session rows: files of one session (main transcript + its subagents) add up; a message id seen
 * in an older file (a resumed or forked session copies history) counts only there.
 */
export function rowsFrom(states: FileState[], ids: Names, dayFrom: number, windowFrom: number, now: number): UsageRow[] {
  const seen = new Set<string>();
  const by = new Map<string, { calls: Call[]; cwd: string | null; model: string | null }>();
  for (const st of [...states].sort((a, b) => a.mtime - b.mtime)) {
    const r = by.get(st.session_id) ?? { calls: [], cwd: null, model: null };
    for (const [id, c] of st.calls) {
      if (seen.has(id)) continue;
      seen.add(id);
      r.calls.push(c);
    }
    r.cwd = st.cwd ?? r.cwd;
    r.model = st.model ?? r.model;
    by.set(st.session_id, r);
  }
  const rows: UsageRow[] = [];
  for (const [sid, r] of by) {
    const today = sumCalls(r.calls, dayFrom);
    const window = sumCalls(r.calls, windowFrom);
    if (!today.calls && !window.calls) continue;
    const alias = ids.alias.get(sid) ?? null;
    rows.push({
      key: alias ?? sid,
      session_id: sid,
      label: sessionLabel({ label: ids.names.get(sid) ?? "", name: alias ?? sid, session_id: sid }),
      project: projectOf(r.cwd, now),
      model: r.model,
      today,
      window,
      last_at: r.calls.reduce<number | null>((a, c) => (a == null || c.ts > a ? c.ts : a), null),
    });
  }
  return rows.sort((a, b) => totalTokens(b.today) - totalTokens(a.today));
}

/** HQ project roots: registered projects plus the git roots of sessions HQ saw in the last 2 days. */
export function hqRoots(db: DatabaseSync, now: number): string[] {
  const roots = new Map<string, string>();
  const add = (p: string | null | undefined) => {
    const info = projectOf(p, now);
    if (info) roots.set(info.root.toLowerCase(), info.root);
  };
  for (const r of db.prepare("SELECT path FROM projects").all() as { path: string }[]) add(r.path);
  for (const r of db.prepare("SELECT cwd FROM sessions WHERE cwd IS NOT NULL AND updated_at > ?").all(now - RECENT_SESSIONS) as { cwd: string }[])
    add(r.cwd);
  return [...roots.values()];
}

function names(db: DatabaseSync): Names {
  const alias = new Map((db.prepare("SELECT session_id, name FROM session_alias").all() as { session_id: string; name: string }[]).map((r) => [r.session_id, r.name]));
  const names = new Map((db.prepare("SELECT session_id, name FROM session_names").all() as { session_id: string; name: string }[]).map((r) => [r.session_id, r.name]));
  return { alias, names };
}

export async function usageReport(db: DatabaseSync, now = Date.now(), budget = BYTES_PER_REQUEST): Promise<UsageReport> {
  const t0 = performance.now();
  const limits = readLimitSource();
  const day = dayStart(now);
  const win = windowStart(limits, now);
  const keepFrom = Math.min(day, win);
  const dirs = transcriptDirs(hqRoots(db, now));
  const scan = await scanTranscripts(dirs, keepFrom, budget);
  const rows = rowsFrom(scan.states, names(db), day, win, now);
  const totals = {
    today: sumAll(scan.states, day),
    window: sumAll(scan.states, win),
  };
  return {
    at: now,
    day_start: day,
    window_start: win,
    limits,
    rows,
    totals,
    scan: { files: scan.states.length, read_bytes: scan.read_bytes, pending_bytes: scan.pending_bytes, ms: Math.round(performance.now() - t0) },
    rest_pct: REST_PCT,
    context_cap: CONTEXT_CAP,
  };
}

/** Totals over every deduped call (median over all calls, not a median of medians). */
function sumAll(states: FileState[], from: number): Tokens {
  const seen = new Map<string, Call>();
  for (const st of states) for (const [id, c] of st.calls) if (!seen.has(id)) seen.set(id, c);
  return sumCalls(seen.values(), from);
}
