import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isOmpRoomId, sessionLabel } from "../labels";
import { deriveFloor, type FloorRow, type LsInput } from "../floor";
import { projectIdFor } from "./db";
import { inboxLive } from "./inbox";
import { mergedSessions, run, type SessionView } from "./proc";

type LsRow = LsInput & {
  name: string;
  sid?: string | null;
  title?: string | null;
  repo?: string | null;
  engine?: string | null;
  tokens?: number | null;
  inbox_id?: string | null;
};

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

/**
 * Newest `su-code/ship/<slug>/STANDUP.md` under a session's repo ("~/x" or absolute), or null.
 * `8sync ccc standup <slug>` appends it; a fresh one puts the room in a sprint meeting (lib/floor.ts).
 */
export function newestStandup(repo: string | null | undefined, home = os.homedir()): { slug: string; at: number } | null {
  if (!repo || repo.startsWith("-")) return null;
  const dir = path.join(expand(repo, home), "su-code", "ship");
  let best: { slug: string; at: number } | null = null;
  let slugs: string[];
  try {
    slugs = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const slug of slugs) {
    try {
      const at = fs.statSync(path.join(dir, slug, "STANDUP.md")).mtimeMs;
      if (!best || at > best.at) best = { slug, at };
    } catch {
      /* no standup in this ship dir */
    }
  }
  return best;
}

async function build(db: DatabaseSync): Promise<FloorRow[]> {
  const [ls, merged] = await Promise.all([lsRows(), mergedSessions(db).catch(() => [] as SessionView[])]);
  const now = Date.now();
  const used = new Set<string>();
  const ids = new Set<string>();
  // One readdir per repo per build, not per session.
  const standups = new Map<string, ReturnType<typeof newestStandup>>();
  const standupOf = (repo: string | null | undefined) => {
    const k = repo ?? "";
    if (!standups.has(k)) standups.set(k, newestStandup(repo));
    return standups.get(k) ?? null;
  };
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
      tokens: typeof r.tokens === "number" ? r.tokens : null,
      inbox_id: typeof r.inbox_id === "string" ? r.inbox_id : null,
      live: r.status === "running" || r.status === "active",
      ...deriveFloor(r, { ...(hq ?? {}), standup: standupOf(repo) }, now),
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
      inbox_id: s.session_id,
      live: true,
      ...deriveFloor(null, { ...s, standup: standupOf(repo) }, now),
    });
  }
  return rows;
}

/** hq has no hook data for omp rooms: the desk state stands in for the session status. */
const OMP_STATUS: Partial<Record<FloorRow["state"], SessionView["status"]>> = { waiting: "needs_input", idle: "idle", done: "idle" };

/**
 * The omp team's live rooms as sessions (contract C3/C4). HQ cannot type into them; it queues into
 * their inbox by `inbox_id`, so they join the room list, "Giao việc" and "Cả dự án" like any inbox room.
 */
export function ompSessions(db: DatabaseSync, rows: FloorRow[]): SessionView[] {
  return rows.flatMap((r): SessionView[] => {
    const id = r.inbox_id;
    if (r.engine !== "omp" || !r.live || !isOmpRoomId(id)) return [];
    const cwd = r.repo ? expand(r.repo) : null;
    return [
      {
        name: id,
        label: r.name,
        session_id: id,
        project_id: projectIdFor(db, cwd),
        status: OMP_STATUS[r.state] ?? "running",
        started_at: r.last_active ? r.last_active * 1000 : null,
        cwd,
        tmux: false,
        source: "omp",
        detail: r.caption || null,
        inbox_live: inboxLive(id),
        engine: "omp",
      },
    ];
  });
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
