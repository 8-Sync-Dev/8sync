import os from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { deriveFloor, type FloorRow, type LsInput } from "../floor";
import { mergedSessions, run, type SessionView } from "./proc";

type LsRow = LsInput & { name: string; title?: string | null; repo?: string | null; engine?: string | null };

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

/**
 * hq session for an ls row: same name or session id, not already taken, and
 * (when several match) the one whose cwd is the row's repo.
 */
function matchHq(r: LsRow, merged: SessionView[], used: Set<string>): SessionView | null {
  if (!claudeEngine(r.engine)) return null;
  // `repo` is "~/x", an absolute path, or Claude's dash-encoded project dir.
  const sameDir = (cwd: string | null | undefined) =>
    !!cwd && (tilde(cwd) === r.repo || cwd.replace(/\/+$/, "") === r.repo || cwd.replace(/[/.]/g, "-") === r.repo);
  const hits = merged.filter(
    (s) => !used.has(s.name) && (s.name === r.name || s.session_id === r.name) && (!r.repo || !s.cwd || sameDir(s.cwd)),
  );
  return hits.find((s) => sameDir(s.cwd)) ?? hits[0] ?? null;
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
  const rows: FloorRow[] = ls.map((r) => {
    const hq = matchHq(r, merged, used);
    if (hq) used.add(hq.name);
    const name = hq?.name ?? r.name;
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
      title: s.label || short(s.name),
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
