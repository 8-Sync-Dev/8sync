// "Bản đồ code" tab: what `trail` (the tree-sitter code map a repo keeps in `.trail/cache/`) says
// about a registered project. Pure: the shapes the API returns, the parsers of `trail … --json`
// output, and the checks on what the browser may ask for. Server side: lib/server/trail.ts.
// Tested in tests/codemap.test.ts.

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** A symbol many others point at: `trail map` hubs and hotspots. */
export type MapHub = { name: string; kind: string; path: string; line: number | null; inDegree: number };
/** One row under a scope: a folder (or a lone file) with its counts and its busiest symbols. */
export type MapEntry = { path: string; label: string; isFile: boolean; files: number; symbols: number; languages: string[]; hubs: MapHub[] };
/** A top-level module (`apps/hq-ui/`, `crates/cli/`, `(root)`), its rows in trail's order. */
export type MapScope = { scope: string; files: number; symbols: number; entries: MapEntry[]; dropped: number };
export type CodeMap = {
  totals: { files: number; symbols: number; edges: number; languages: string[] };
  scopes: MapScope[];
  hotspots: MapHub[];
};

/** A search result: a place in a file (line null when trail gave none) and what is there. */
export type SearchHit = { file: string; line: number | null; title: string; kind: string; text: string };
export type SearchMode = "ask" | "grep";
export type SearchResult = { mode: SearchMode; hits: SearchHit[]; total: number };

export type SkeletonEntry = { name: string; kind: string; line: number | null; signature: string };
export type Skeleton = { file: string; entries: SkeletonEntry[]; note: string | null };

/** Where the index is and when `trail build` last wrote it (the wiring graph's mtime). */
export type IndexState = { indexed: boolean; builtAt: number | null; dir: string | null };
export type BuildState = { state: "running" | "done" | "failed"; startedAt: number; endedAt: number | null; progress: { done: number; total: number } | null; tail: string; error: string | null };
export type CodemapStatus = {
  project: { id: number; name: string; root: string };
  trail: boolean;
  index: IndexState;
  build: BuildState | null;
  /** `graphify-out/` exists; `html` is its viewable graph when graphify wrote one. */
  graph: { dir: boolean; html: { size: number; mtime: number } | null };
};

export const QUERY_MAX = 300;
export const FILE_MAX = 512;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");
// C0 controls and DEL; tab and newline included: none belong in a query or a path.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** First line of a trail span (`L118-L132` → 118). */
export function spanLine(span: unknown): number | null {
  const m = /^L(\d+)/.exec(str(span));
  return m ? Number(m[1]) : null;
}

/** `path:L22-L28` (an ask pointer) → file and first line. */
export function pointerOf(p: unknown): { file: string; line: number | null } {
  const s = str(p);
  const m = /^(.*):L(\d+)(?:-L\d+)?$/.exec(s);
  return m ? { file: m[1], line: Number(m[2]) } : { file: s, line: null };
}

function hub(v: unknown): MapHub | null {
  const h = obj(v);
  if (!h || !str(h.name)) return null;
  return { name: str(h.name), kind: str(h.kind), path: str(h.path), line: spanLine(h.span), inDegree: num(h.inDegree) };
}
const hubs = (v: unknown): MapHub[] => arr(v).map(hub).filter((h): h is MapHub => h !== null);

function entry(v: unknown, scope: string): MapEntry | null {
  const d = obj(v);
  const p = d ? str(d.path) : "";
  if (!d || !p) return null;
  const label = scope && scope !== "(root)" && p.startsWith(scope) && p.length > scope.length ? p.slice(scope.length) : p;
  return { path: p, label, isFile: d.isFile === true, files: num(d.files), symbols: num(d.symbols), languages: strs(d.languages), hubs: hubs(d.hubs) };
}

function scopeOf(name: string, rows: unknown, dropped: unknown): MapScope {
  const entries = arr(rows)
    .map((x) => entry(x, name))
    .filter((e): e is MapEntry => e !== null);
  return {
    scope: name,
    files: entries.reduce((n, e) => n + e.files, 0),
    symbols: entries.reduce((n, e) => n + e.symbols, 0),
    entries,
    dropped: num(dropped),
  };
}

/**
 * `trail map --json` → modules → folders/files → symbol counts. A repo trail does not split into
 * scopes lists its folders at the top (`dirs`): they become one "(root)" module.
 */
export function parseMap(v: unknown): CodeMap | null {
  const m = obj(v);
  const t = m && obj(m.totals);
  if (!m || !t) return null;
  const scopes = arr(m.scopes)
    .map(obj)
    .filter((s): s is Record<string, unknown> => s !== null && !!str(s.scope))
    .map((s) => scopeOf(str(s.scope), s.dirs, s.dropped));
  if (!scopes.length && arr(m.dirs).length) scopes.push(scopeOf("(root)", m.dirs, m.dropped));
  return {
    totals: { files: num(t.files), symbols: num(t.symbols), edges: num(t.edges), languages: strs(t.languages) },
    scopes,
    hotspots: hubs(m.hotspots),
  };
}

/** `trail ask --json` → its ranked hits (learnings and other hits without a file are dropped). */
export function parseAsk(v: unknown): SearchResult | null {
  const m = obj(v);
  if (!m || !Array.isArray(m.hits)) return null;
  const hits: SearchHit[] = [];
  for (const x of m.hits) {
    const h = obj(x);
    if (!h) continue;
    const at = pointerOf(h.pointer);
    if (!at.file) continue;
    const [title, kind] = str(h.title).split(" · ");
    hits.push({ file: at.file, line: at.line, title: title || at.file, kind: kind ?? str(h.kind), text: str(h.snippet) });
  }
  return { mode: "ask", hits, total: hits.length };
}

/** `trail grep --json` → one hit per matching line, under the symbol that encloses it. */
export function parseGrep(v: unknown): SearchResult | null {
  const m = obj(v);
  if (!m || !Array.isArray(m.groups)) return null;
  const hits: SearchHit[] = [];
  for (const x of m.groups) {
    const g = obj(x);
    if (!g) continue;
    const sym = obj(g.symbol);
    const file = str(g.path) || str(sym?.path);
    if (!file) continue;
    for (const y of arr(g.hits)) {
      const l = obj(y);
      if (!l) continue;
      hits.push({ file, line: num(l.line) || null, title: str(sym?.name) || "(cấp file)", kind: str(sym?.kind), text: str(l.text) });
    }
  }
  return { mode: "grep", hits, total: num(m.totalHits) || hits.length };
}

/** `trail skeleton --json` → the file's signatures in order. */
export function parseSkeleton(v: unknown): Skeleton | null {
  const m = obj(v);
  if (!m || !str(m.file) || !Array.isArray(m.entries)) return null;
  const entries = m.entries
    .map(obj)
    .filter((e): e is Record<string, unknown> => e !== null && !!str(e.name))
    .map((e) => ({ name: str(e.name), kind: str(e.kind), line: spanLine(e.span), signature: str(e.signature) || str(e.name) }));
  return { file: str(m.file), entries, note: str(m.note) || null };
}

export const isSearchMode = (v: unknown): v is SearchMode => v === "ask" || v === "grep";

/** What the search box may send: plain text, not `-` (ask would read stdin), a grep pattern that compiles. */
export function checkQuery(mode: SearchMode, raw: unknown): Checked<string> {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (!q) return { ok: false, error: "nhập điều cần tìm" };
  if (q.length > QUERY_MAX) return { ok: false, error: `tối đa ${QUERY_MAX} ký tự` };
  if (CONTROL.test(q)) return { ok: false, error: "có ký tự điều khiển" };
  if (q === "-") return { ok: false, error: "nhập điều cần tìm" };
  if (mode === "grep") {
    try {
      new RegExp(q);
    } catch {
      return { ok: false, error: "mẫu regex không hợp lệ" };
    }
  }
  return { ok: true, value: q };
}

/**
 * A file the browser names for `trail skeleton`: repo-relative, forward or back slashes, no `..`,
 * no drive or leading slash. The server also resolves it on disk inside the project root.
 */
export function checkRelFile(raw: unknown): Checked<string> {
  const f = typeof raw === "string" ? raw.trim() : "";
  if (!f) return { ok: false, error: "thiếu file" };
  if (f.length > FILE_MAX || CONTROL.test(f)) return { ok: false, error: "tên file không hợp lệ" };
  if (/^[\\/]/.test(f) || /^[a-zA-Z]:/.test(f) || f.includes(":")) return { ok: false, error: "chỉ nhận đường dẫn tương đối trong dự án" };
  const parts = f.split(/[\\/]/);
  if (parts.some((p) => p === ".." || p === "." || p === "")) return { ok: false, error: "chỉ nhận đường dẫn tương đối trong dự án" };
  return { ok: true, value: parts.join("/") };
}

/** The project id in a query or body: a positive integer. */
export function checkProjectId(raw: unknown): Checked<number> {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^[1-9]\d{0,8}$/.test(s)) return { ok: false, error: "project: cần id dự án" };
  return { ok: true, value: Number(s) };
}

/** `parsing 152/587: path` lines of `trail build` (stderr, rewritten with `\r`): how far it is. */
export function buildProgress(text: string): { done: number; total: number } | null {
  let last: { done: number; total: number } | null = null;
  for (const m of text.matchAll(/parsing (\d+)\/(\d+)/g)) last = { done: Number(m[1]), total: Number(m[2]) };
  return last;
}

/** Terminal colour codes out of trail's text. */
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
