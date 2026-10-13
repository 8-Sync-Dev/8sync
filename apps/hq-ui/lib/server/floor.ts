import type { DatabaseSync } from "node:sqlite";
import { deriveFloor, type FloorRow, type LsInput } from "../floor";
import { mergedSessions, run, type SessionView } from "./proc";

type LsRow = LsInput & { name: string; title?: string | null };

const TTL_MS = 4000;
let cache: { at: number; rows: FloorRow[] } | null = null;
let inflight: Promise<FloorRow[]> | null = null;

const UUID_ISH = /^[0-9a-f]{8}(-[0-9a-f]{4}){0,4}/i;
const short = (n: string) => (UUID_ISH.test(n) ? n.slice(0, 8) : n);

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
  const rows: FloorRow[] = ls.map((r) => {
    const hq = merged.find((s) => s.name === r.name || s.session_id === r.name) ?? null;
    if (hq) used.add(hq.name);
    const name = hq?.name ?? r.name;
    const title = r.title?.trim() || (hq && hq.label !== hq.name ? hq.label : "") || (hq?.name.startsWith("hq-") ? hq.name : "") || short(r.name);
    return { id: name, name, title, last_active: r.last_active ?? null, hq: !!hq, ...deriveFloor(r, hq, now) };
  });
  // hq sessions `8sync ls` does not know (fresh tmux panes, `claude agents` only).
  for (const s of merged) {
    if (used.has(s.name) || s.status === "ended") continue;
    rows.push({
      id: s.name,
      name: s.name,
      title: s.label || short(s.name),
      last_active: s.started_at ? Math.floor(s.started_at / 1000) : null,
      hq: true,
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
