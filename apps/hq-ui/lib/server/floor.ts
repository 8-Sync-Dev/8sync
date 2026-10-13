import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { sessionLabel } from "../labels";
import { deriveFloor, type FloorRow, type LsInput } from "../floor";
import { mergedSessions, run, type SessionView } from "./proc";

type LsRow = LsInput & { name: string; sid?: string | null; title?: string | null; repo?: string | null; engine?: string | null };

const TTL_MS = 4000;
let cache: { at: number; rows: FloorRow[] } | null = null;
let inflight: Promise<FloorRow[]> | null = null;

const UUID_ISH = /^[0-9a-f]{8}(-[0-9a-f]{4}){0,4}/i;
const short = (n: string) => (UUID_ISH.test(n) ? n.slice(0, 8) : n);
const sidOf = (...ids: (string | null | undefined)[]) => {
  const v = ids.find((x) => x && UUID_ISH.test(x));
  return v ? v.slice(0, 8) : null;
};

/** "/home/me/x" -> "~/x", same spelling `8sync ls` uses for `repo`. */
export function tilde(p: string | null | undefined, home = os.homedir()): string | null {
  if (!p) return null;
  const v = p.replace(/\/+$/, "");
  return v === home ? "~" : v.startsWith(`${home}/`) ? `~${v.slice(home.length)}` : v;
}

/** hq only tracks Claude Code; omp/feynman/forge rows never join an hq session. */
const claudeEngine = (e: string | null | undefined) => !e || e === "ccc" || e === "claude";

const trimSlash = (p: string) => p.replace(/\/+$/, "");
/** Expand "~" so ls `repo` and hq cwd compare as absolute paths. */
const expand = (p: string, home = os.homedir()) => (p === "~" ? home : p.startsWith("~/") ? home + p.slice(1) : p);
/** `repo` may also be Claude's dash-encoded project dir. */
const dashed = (p: string) => p.replace(/[/.]/g, "-");

/** cwd equals the ls repo, or sits inside it (subfolder / worktree). */
function cwdInRepo(cwd: string | null | undefined, repo: string | null | undefined): "exact" | "inside" | null {
  if (!cwd || !repo) return null;
  const c = trimSlash(cwd);
  const r = trimSlash(expand(repo));
  if (c === r || dashed(c) === repo) return "exact";
  return c.startsWith(`${r}/`) || dashed(c).startsWith(`${repo}-`) ? "inside" : null;
}

/**
 * Pair every Claude ls row with at most one hq session. Order: (a) session id,
 * (b) same name with a compatible cwd, (c) cwd inside the repo when that pairing
 * is unambiguous. Returns ls index -> hq session.
 */
function pairHq(ls: LsRow[], merged: SessionView[]): Map<number, SessionView> {
  const out = new Map<number, SessionView>();
  const taken = new Set<SessionView>();
  const free = (i: number) => !out.has(i) && claudeEngine(ls[i].engine);
  const give = (i: number, s: SessionView) => {
    out.set(i, s);
    taken.add(s);
  };
  // (a) session id: ls `sid`, or an unnamed row whose name is the transcript uuid.
  ls.forEach((r, i) => {
    if (!free(i)) return;
    const id = sidOf(r.sid, r.name);
    const s = id && merged.find((m) => !taken.has(m) && sidOf(m.session_id) === id);
    if (s) give(i, s);
  });
  // (b) name; two sessions called "core" in different repos stay apart by cwd.
  ls.forEach((r, i) => {
    if (!free(i)) return;
    const hits = merged.filter((m) => !taken.has(m) && m.name === r.name && (!r.repo || !m.cwd || cwdInRepo(m.cwd, r.repo)));
    const s = hits.find((m) => cwdInRepo(m.cwd, r.repo) === "exact") ?? hits[0];
    if (s) give(i, s);
  });
  // (c) cwd only: one free ls row and one free hq session in that folder.
  for (const s of merged) {
    if (taken.has(s) || !s.cwd) continue;
    const rows = ls.map((_, i) => i).filter((i) => free(i) && cwdInRepo(s.cwd, ls[i].repo));
    if (rows.length !== 1) continue;
    const rival = merged.filter((m) => !taken.has(m) && m !== s && cwdInRepo(m.cwd, ls[rows[0]].repo));
    if (!rival.length) give(rows[0], s);
  }
  return out;
}

async function lsRows(): Promise<LsRow[]> {
  const r = await run("8sync", ["ls", "--json", "--all"], 8000);
  if (!r.ok) return []; // 8sync missing or failed
  try {
    const v = JSON.parse(r.stdout);
    return Array.isArray(v) ? (v as LsRow[]).filter((x) => x && typeof x.name === "string") : [];
  } catch {
    return [];
  }
}

async function build(db: DatabaseSync): Promise<FloorRow[]> {
  const [ls, merged] = await Promise.all([lsRows(), mergedSessions(db).catch(() => [] as SessionView[])]);
  const now = Date.now();
  const used = new Set<string>();
  const ids = new Set<string>();
  const uniq = (base: string) => {
    let id = base;
    for (let n = 2; ids.has(id); n++) id = `${base}#${n}`;
    ids.add(id);
    return id;
  };
  const paired = pairHq(ls, merged);
  for (const s of paired.values()) used.add(s.name);
  const rows: FloorRow[] = ls.map((r, i) => {
    const hq = paired.get(i) ?? null;
    // hq may report its session uuid as `name` (unnamed session): keep the ls name, the id goes to `sid`.
    const name = hq && !UUID_ISH.test(hq.name) ? hq.name : r.name;
    const title = r.title?.trim() || (hq && hq.label !== hq.name ? hq.label : "") || (hq?.name.startsWith("hq-") ? hq.name : "") || short(r.name);
    const repo = r.repo ?? tilde(hq?.cwd);
    const engine = r.engine ?? (hq ? "ccc" : null);
    return {
      id: uniq(`${engine ?? ""}:${repo ?? ""}:${name}`),
      name,
      title,
      last_active: r.last_active ?? null,
      hq: !!hq,
      repo,
      engine,
      sid: sidOf(hq?.session_id, r.name),
      ...deriveFloor(r, hq, now),
    };
  });
  // hq sessions `8sync ls` does not know (fresh tmux panes, `claude agents` only).
  for (const s of merged) {
    if (used.has(s.name) || s.status === "ended") continue;
    const repo = tilde(s.cwd);
    rows.push({
      id: uniq(`ccc:${repo ?? ""}:${s.name}`),
      name: s.name,
      title: sessionLabel(s),
      unmatched: true,
      last_active: s.started_at ? Math.floor(s.started_at / 1000) : null,
      hq: true,
      repo,
      engine: "ccc",
      sid: sidOf(s.session_id, s.name),
      ...deriveFloor(null, s, now),
    });
  }
  return rows;
}

/** 4 s cache; concurrent callers share one in-flight `8sync ls`. */
export function loadFloor(db: DatabaseSync): Promise<FloorRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.rows);
  inflight ??= build(db)
    .then((rows) => {
      cache = { at: Date.now(), rows };
      return rows;
    })
    .catch(() => [] as FloorRow[])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function resetFloorCache() {
  cache = null;
  inflight = null;
}
