// The workspace tab (components/hq/workspace-view.tsx): pure rules shared by the page and the server —
// omp session names and models as `8sync ccc term --omp-new` accepts them, the omp session rows of a
// folder (`8sync . ls --json`), and the panes the owner keeps open. Tested in tests/omp-workspace.test.ts.

/** A new omp session's name: stricter than the CLI's (lowercase, ≤48) and never one of `8sync .`'s verbs. */
export const OMP_NAME_RE = /^[a-z0-9][a-z0-9._-]{0,47}$/;
const RESERVED = /^(ls|list|rm|mv|merge|new)$/;
export const isOmpSessionName = (s: unknown): s is string => typeof s === "string" && OMP_NAME_RE.test(s) && !RESERVED.test(s);

/** omp `--model` (`provider/model[:thinking]`), as the CLI checks it (crates/cli/src/verbs/ccc/term.rs valid_model). */
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9/._:@-]{0,127}$/;
export const isOmpModel = (s: unknown): s is string => typeof s === "string" && MODEL_RE.test(s);

/** One row of `8sync . ls --json` (the fields the workspace reads; the rest passes through). */
export type OmpSessionRow = {
  name: string;
  engine?: string;
  inbox_id?: string | null;
  status?: string | null;
  title?: string | null;
  doing?: string | null;
  last_active?: number | null;
  last_used?: boolean | null;
  branch?: string | null;
  tokens?: number | null;
  model?: string | null;
  [k: string]: unknown;
};

/** The rows of `8sync . ls --json` output that are omp sessions with an id; anything else is dropped. */
export function parseOmpRows(stdout: string): OmpSessionRow[] {
  try {
    return ompRowsOf(JSON.parse(stdout));
  } catch {
    return [];
  }
}

/** [`parseOmpRows`] of an already parsed answer (the HQ core's `/v1/omp-ls`). */
export function ompRowsOf(v: unknown): OmpSessionRow[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is OmpSessionRow => !!r && typeof r === "object" && typeof r.name === "string" && (r.engine === undefined || r.engine === "omp"));
}

// ── panes ────────────────────────────────────────────────────────────────────

/** An open session window: its terminal id (the omp room id), what it shows, and where it lives. */
export type Pane = { id: string; name: string; cwd: string };
export const MAX_PANES = 4;
export type WorkspaceState = { panes: Pane[]; active: string | null; max: string | null };
export const EMPTY_WORKSPACE: WorkspaceState = { panes: [], active: null, max: null };

const OMP_ID = /^omp-[0-9a-f]{16}$/;

/** A stored workspace, kept only as far as it is well formed (localStorage is user-editable). */
export function readWorkspace(raw: string | null): WorkspaceState {
  let v: unknown;
  try {
    v = raw ? JSON.parse(raw) : null;
  } catch {
    return EMPTY_WORKSPACE;
  }
  if (!v || typeof v !== "object") return EMPTY_WORKSPACE;
  const o = v as Record<string, unknown>;
  const seen = new Set<string>();
  const panes = (Array.isArray(o.panes) ? o.panes : [])
    .filter((p): p is Pane => !!p && typeof p === "object" && OMP_ID.test((p as Pane).id) && typeof (p as Pane).name === "string" && typeof (p as Pane).cwd === "string")
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .slice(0, MAX_PANES)
    .map((p) => ({ id: p.id, name: p.name, cwd: p.cwd }));
  const pick = (x: unknown) => (typeof x === "string" && panes.some((p) => p.id === x) ? x : null);
  return { panes, active: pick(o.active) ?? panes[0]?.id ?? null, max: pick(o.max) };
}

/**
 * Opens `p`: already open → it becomes the active pane; else it is added, and when MAX_PANES are open
 * the oldest one that is not active makes room. A maximized pane gives way to the one just opened.
 */
export function openPane(s: WorkspaceState, p: Pane): WorkspaceState {
  if (s.panes.some((x) => x.id === p.id)) return { ...s, active: p.id, max: s.max && s.max !== p.id ? p.id : s.max };
  let panes = [...s.panes, p];
  if (panes.length > MAX_PANES) {
    const drop = panes.find((x) => x.id !== s.active) ?? panes[0];
    panes = panes.filter((x) => x !== drop);
  }
  return { panes, active: p.id, max: s.max ? p.id : null };
}

/**
 * A plain click in the sidebar (Claude Code Desktop): `p` takes the active pane's place, the other
 * windows stay; already open → it becomes active; no pane yet → the only one.
 */
export function replacePane(s: WorkspaceState, p: Pane): WorkspaceState {
  if (s.panes.some((x) => x.id === p.id)) return openPane(s, p);
  if (s.panes.length === 0) return { panes: [p], active: p.id, max: null };
  const at = Math.max(0, s.panes.findIndex((x) => x.id === s.active));
  return { panes: s.panes.map((x, i) => (i === at ? p : x)), active: p.id, max: s.max ? p.id : null };
}

/** Closes pane `id`; the active one moves to its neighbour. */
export function closePane(s: WorkspaceState, id: string): WorkspaceState {
  const i = s.panes.findIndex((x) => x.id === id);
  if (i < 0) return s;
  const panes = s.panes.filter((x) => x.id !== id);
  const active = s.active === id ? (panes[Math.min(i, panes.length - 1)]?.id ?? null) : s.active;
  return { panes, active, max: s.max === id ? null : s.max };
}

/** How `n` panes sit: 1 → one, 2 → side by side, 3 → one left + two stacked right, 4 → 2×2. Rows of pane indexes. */
export function paneGrid(n: number): number[][] {
  if (n <= 0) return [];
  if (n === 1) return [[0]];
  if (n === 2) return [[0, 1]];
  if (n === 3) return [[0], [1, 2]];
  return [
    [0, 1],
    [2, 3],
  ];
}

// ── folders ──────────────────────────────────────────────────────────────────

/** The last opened folders, newest first, without duplicates, at most `max`. */
export function pushRecent(list: string[], p: string, max = 8): string[] {
  return [p, ...list.filter((x) => x !== p)].slice(0, max);
}

/** A folder's display name: its last path segment (a drive root stays `C:\`). */
export function folderName(p: string): string {
  const t = p.replace(/[\\/]+$/, "");
  const seg = t.split(/[\\/]/).pop() ?? "";
  return seg && !/^[a-z]:$/i.test(seg) ? seg : p;
}

// ── project picker ───────────────────────────────────────────────────────────

/** A folder the picker offers: a repo HQ knows (live rooms, added folders, "Dự án trên máy") or a recent pick. */
export type WsProject = { path: string; name: string; recent?: boolean };

/** Same folder across `\` vs `/`, case and a trailing separator. */
export const pathKey = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * The picker's list: the recent picks first (newest first, `recent: true`), then every other source in
 * order, each folder once (the first source's name wins).
 */
export function mergeProjects(recent: string[], ...sources: WsProject[][]): WsProject[] {
  const named = new Map<string, string>();
  for (const list of sources) for (const p of list) if (!named.has(pathKey(p.path))) named.set(pathKey(p.path), p.name);
  const seen = new Set<string>();
  const out: WsProject[] = [];
  for (const p of recent) {
    const k = pathKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ path: p, name: named.get(k) ?? folderName(p), recent: true });
  }
  for (const list of sources)
    for (const p of list) {
      const k = pathKey(p.path);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ path: p.path, name: p.name });
    }
  return out;
}

/** Projects whose name or path holds `q` (any case, either slash); names that start with it come first. */
export function filterProjects(list: WsProject[], q: string): WsProject[] {
  const s = q.trim().toLowerCase();
  if (!s) return list;
  const sp = pathKey(s);
  const hits = list.filter((p) => p.name.toLowerCase().includes(s) || pathKey(p.path).includes(sp));
  const head = (p: WsProject) => p.name.toLowerCase().startsWith(s);
  return [...hits.filter(head), ...hits.filter((p) => !head(p))];
}

/** `C:\Users\me\code\app` → `~\code\app` when it sits below `home`; any other path unchanged. */
export function shortPath(p: string, home: string | null | undefined): string {
  if (!home) return p;
  const h = pathKey(home);
  const k = pathKey(p);
  if (h && k === h) return "~";
  if (!h || !k.startsWith(`${h}/`)) return p;
  const sep = p.includes("\\") ? "\\" : "/";
  return `~${sep}${p.replace(/[\\/]+$/, "").slice(home.replace(/[\\/]+$/, "").length + 1)}`;
}

/** The folder holding `p` (`C:\a\b` → `C:\a`); null when that would be a drive or filesystem root. */
function parentOf(p: string): string | null {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  if (i <= 0) return null;
  const up = t.slice(0, i);
  return /^[a-z]:$/i.test(up) ? null : up;
}

/** Throwaway places a scan finds repos in (test fixtures under %TEMP%, app data): never where browsing starts. */
const SCRATCH = /\/(appdata|temp|tmp)(\/|$)/;

/**
 * Where "Duyệt thư mục…" opens: the folder holding the most known projects (the machine's Projects folder),
 * counting every ancestor so a deep group of repos can't outvote it; a tie goes to the deeper folder.
 * Folders above `home` (C:\Users) and temp folders never count; with nothing left, `home`. Never a drive root.
 */
export function browseStart(paths: string[], home: string | null): string | null {
  const above = home ? `${pathKey(home)}/` : null;
  const count = new Map<string, { path: string; n: number }>();
  for (const p of paths) {
    if (SCRATCH.test(pathKey(p))) continue;
    for (let up = parentOf(p); up; up = parentOf(up)) {
      const k = pathKey(up);
      if (above?.startsWith(`${k}/`)) continue;
      const c = count.get(k);
      if (c) c.n++;
      else count.set(k, { path: up, n: 1 });
    }
  }
  let best: { path: string; n: number } | null = null;
  for (const c of count.values()) if (!best || c.n > best.n || (c.n === best.n && c.path.length > best.path.length)) best = c;
  return best?.path ?? home ?? null;
}
