import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isOmpRoomId, sessionLabel } from "../labels";
import { roomLabel } from "../room-label";
import { deriveFloor, type FloorRow, type LsInput } from "../floor";
import { projectIdFor } from "./db";
import { coreGet } from "./core";
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
  model?: string | null;
  /** Local transcript file (`8sync ls`): kept server side, never sent to the browser. */
  transcript?: string | null;
};

const TTL_MS = 4000;
let cache: { at: number; rows: FloorRow[]; transcripts: Map<string, string> } | null = null;
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
/** Expand "~" so ls `repo` and hq cwd compare as absolute paths (`8sync ls` on Windows prints `~\x`). */
const expand = (p: string, home = os.homedir()) => (p === "~" ? home : p.startsWith("~/") || p.startsWith("~\\") ? home + p.slice(1) : p);
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

/** `8sync ls --json --all`: from the core's warm copy when there is one, else one process. */
async function lsRows(): Promise<LsRow[]> {
  let v: unknown = (await coreGet("/v1/ls"))?.v;
  if (v === undefined) {
    const r = await run("8sync", ["ls", "--json", "--all"], 8000);
    if (!r.ok) return []; // 8sync missing or failed
    try {
      v = JSON.parse(r.stdout);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? (v as LsRow[]).filter((x) => x && typeof x.name === "string") : [];
}

async function build(db: DatabaseSync): Promise<{ rows: FloorRow[]; transcripts: Map<string, string> }> {
  const [ls, merged] = await Promise.all([lsRows(), mergedSessions(db).catch(() => [] as SessionView[])]);
  // omp room id -> its transcript, for "Nhật ký" (readOmpActivity). Only absolute `.jsonl` paths.
  const transcripts = new Map<string, string>();
  for (const r of ls) {
    if (r.engine === "omp" && isOmpRoomId(r.inbox_id) && typeof r.transcript === "string" && path.isAbsolute(r.transcript) && r.transcript.endsWith(".jsonl")) transcripts.set(r.inbox_id, r.transcript);
  }
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
    const title = roomLabel(r.title?.trim() || (hq && hq.label !== hq.name ? hq.label : "") || (hq?.name.startsWith("hq-") ? hq.name : "") || short(r.name));
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
      // Alive: a process has it open (`8sync ls`) or its hq session is in tmux / `claude agents`.
      live: r.status === "running" || r.status === "active" || (hq != null && hq.status !== "ended"),
      model: typeof r.model === "string" ? r.model : null,
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
      inbox_id: s.session_id,
      live: true,
      ...deriveFloor(null, s, now),
    });
  }
  return { rows, transcripts };
}

/** hq has no hook data for omp rooms: the desk state stands in for the session status. */
const OMP_STATUS: Partial<Record<FloorRow["state"], SessionView["status"]>> = { waiting: "needs_input", idle: "idle", done: "idle" };

/**
 * The live omp rooms as sessions (contract C3/C4). HQ cannot type into them; it queues into their
 * inbox by `inbox_id`, so they join the room list like any inbox room. `model`: the row's own `8sync ls` model.
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
        model: r.model ?? null,
      },
    ];
  });
}

/** 4 s cache; concurrent callers share one in-flight `8sync ls`. */
export function loadFloor(db: DatabaseSync): Promise<FloorRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.rows);
  inflight ??= build(db)
    .then(({ rows, transcripts }) => {
      cache = { at: Date.now(), rows, transcripts };
      return rows;
    })
    .catch(() => [] as FloorRow[])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Transcript file of the omp room `id` (from `8sync ls`, never from a client), or null. */
export async function ompTranscript(db: DatabaseSync, id: string): Promise<string | null> {
  if (!isOmpRoomId(id)) return null;
  await loadFloor(db);
  return cache?.transcripts.get(id) ?? null;
}

/** The omp room `id` as `8sync ls` lists it (any status: its terminal can start it), or null. `cwd`: its repo. */
export async function ompRoom(db: DatabaseSync, id: string): Promise<{ cwd: string | null } | null> {
  if (!isOmpRoomId(id)) return null;
  const r = (await loadFloor(db)).find((x) => x.engine === "omp" && x.inbox_id === id);
  return r ? { cwd: r.repo ? expand(r.repo) : null } : null;
}

export function resetFloorCache() {
  cache = null;
  inflight = null;
}
