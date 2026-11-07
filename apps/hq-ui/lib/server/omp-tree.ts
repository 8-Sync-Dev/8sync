// Every omp session HQ can open, for the sidebar's session tree (GET /api/omp/sessions?all=1): the omp
// rows of `8sync ls --all` (lib/server/floor.ts, its 4 s cache) with their folder resolved, their creation
// time from the `8sync .` registry, and their `task` subagents as sub-sessions (omp-children.ts). A session created by POST
// /api/omp/sessions that ls does not list yet shows as starting. Read-only: nothing here writes.
// Tested in tests/session-tree.test.ts.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isOmpRoomId } from "../labels";
import { groupKey } from "../sidebar";
import { treeStateOfFloor, type OmpTreeRow } from "../session-tree";
import { expand, loadFloor, ompTranscript } from "./floor";
import { ompChildren } from "./omp-children";
import { ompRegistryDir, ompRepoDir, pendingAll } from "./omp-sessions";

const DAY_MS = 24 * 3600_000;

/** `<root>\0<name>` → creation ms, from every `<registry>/<key>/index.json`. */
export function registryCreated(registry = ompRegistryDir()): Map<string, number> {
  const out = new Map<string, number>();
  let keys: string[];
  try {
    keys = fs.readdirSync(registry);
  } catch {
    return out;
  }
  for (const k of keys) {
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(registry, k, "index.json"), "utf8")) as { root?: unknown; sessions?: unknown };
      if (typeof idx.root !== "string" || !Array.isArray(idx.sessions)) continue;
      for (const s of idx.sessions as { name?: unknown; created?: unknown }[]) {
        if (typeof s?.name === "string" && typeof s.created === "number") out.set(`${groupKey(idx.root)}\0${s.name}`, s.created * 1000);
      }
    } catch {
      // a project folder without a readable index: skip it
    }
  }
  return out;
}

const TTL_MS = 3000;
let cache: { at: number; rows: Promise<OmpTreeRow[]> } | null = null;

/** Every omp session (any status), newest first. Sub-sessions only for sessions active in the last day. */
export function allOmpSessions(db: DatabaseSync, now = Date.now()): Promise<OmpTreeRow[]> {
  if (cache && now - cache.at < TTL_MS) return cache.rows;
  const rows = build(db, now);
  cache = { at: now, rows };
  rows.catch(() => (cache = null));
  return rows;
}

/** A deleted session leaves the tree at once, not after the TTL. */
export const forgetOmpTree = () => (cache = null);

async function build(db: DatabaseSync, now: number): Promise<OmpTreeRow[]> {
  const floor = await loadFloor(db);
  const created = registryCreated();
  const out: OmpTreeRow[] = [];
  const seen = new Set<string>();
  for (const r of floor) {
    const id = r.inbox_id;
    if (r.engine !== "omp" || !isOmpRoomId(id) || seen.has(id)) continue;
    seen.add(id);
    const cwd = r.repo ? ompRepoDir(expand(r.repo)) : null;
    const at = r.last_active ? r.last_active * 1000 : null;
    const transcript = at && now - at <= DAY_MS ? await ompTranscript(db, id) : null;
    out.push({
      id,
      name: r.name,
      title: r.title || null,
      cwd,
      state: treeStateOfFloor(r.state),
      doing: r.caption || null,
      last_active: at,
      created: cwd ? (created.get(`${groupKey(cwd)}\0${r.name}`) ?? null) : null,
      children: transcript ? ompChildren(transcript, id, now, r.live) : [],
    });
  }
  for (const [id, p] of pendingAll(now)) {
    if (seen.has(id)) continue;
    out.push({ id, name: p.name, title: null, cwd: p.cwd, state: "working", doing: "Đang mở phiên…", last_active: p.at, created: p.at, children: [] });
  }
  return out.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0));
}
