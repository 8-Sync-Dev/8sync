// Every omp session HQ can open, for the sidebar's session tree (GET /api/omp/sessions?all=1): the omp
// rows of `8sync ls --all` (lib/server/floor.ts, its 4 s cache) with their folder resolved, their creation
// time from the `8sync .` registry, and their `task` subagents as sub-sessions. A session created by POST
// /api/omp/sessions that ls does not list yet shows as starting. Read-only: nothing here writes.
// Tested in tests/session-tree.test.ts.
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isOmpRoomId } from "../labels";
import { groupKey } from "../sidebar";
import { treeStateOfFloor, type OmpTreeRow, type TreeChild } from "../session-tree";
import { expand, loadFloor, ompTranscript } from "./floor";
import { ompRegistryDir, ompRepoDir, pendingAll } from "./omp-sessions";

/** A subagent whose transcript moved this recently and that has no result yet is still working. */
const CHILD_LIVE_MS = 90_000;
const CHILDREN_MAX = 40;
const DAY_MS = 24 * 3600_000;

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

/**
 * The `task` subagents of an omp transcript: omp writes each one next to the parent transcript, in the
 * folder named like it (`<ts>_<uuid>/<Agent>.jsonl`), and its final answer as `<Agent>.md` when it ends.
 * Result → Xong; an empty result → Lỗi (it ended without answering); no result and a transcript that
 * moved in the last 90 s → Đang làm; else nghỉ (stopped). Running first, then newest; at most 40.
 */
export function ompChildren(transcript: string, parentId: string, now = Date.now()): TreeChild[] {
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
    let at: number;
    try {
      at = fs.statSync(path.join(dir, f)).mtimeMs;
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
    const state = size === null ? (now - at <= CHILD_LIVE_MS ? "working" : "idle") : size > 0 ? "done" : "error";
    const detail = size ? firstLine(md) : size === 0 ? "Kết thúc mà không có kết quả" : null;
    out.push({ key: `${parentId}/${agent}`, title: agent, state, at: Math.round(at), detail });
  }
  return out.sort((a, b) => Number(b.state === "working") - Number(a.state === "working") || (b.at ?? 0) - (a.at ?? 0)).slice(0, CHILDREN_MAX);
}

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
      children: transcript ? ompChildren(transcript, id, now) : [],
    });
  }
  for (const [id, p] of pendingAll(now)) {
    if (seen.has(id)) continue;
    out.push({ id, name: p.name, title: null, cwd: p.cwd, state: "working", doing: "Đang mở phiên…", last_active: p.at, created: p.at, children: [] });
  }
  return out.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0));
}
