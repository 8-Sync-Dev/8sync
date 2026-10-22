// The machine's knowledge tree (`8sync ccc know ls --json`): one book per repo, the chosen project's
// first. Pure parsing here; components/hq/know-view.tsx renders it. Tested in tests/know.test.ts.

export type Lesson = { day: string | null; room: string | null; text: string };
export type Book = { root: string; lessons: Lesson[] };
export type Know = { /** The company book (`know add --shared`): lessons for every project. */ shared: Book | null; own: Book | null; others: Book[]; dir: string | null };

/** `- 2026-10-22 [dev] gitleaks full history eats 4 GB` → its parts; a line without the stamp is text only. */
export function lessonParts(line: string): Lesson {
  const m = /^-\s+(\d{4}-\d{2}-\d{2})\s+(?:\[([^\]]*)\]\s+)?(.*)$/.exec(line);
  if (!m) return { day: null, room: null, text: line.replace(/^-\s*/, "") };
  return { day: m[1], room: m[2] ?? null, text: m[3] };
}

function book(v: unknown): Book | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { root?: unknown; lines?: unknown };
  if (typeof o.root !== "string") return null;
  const lines = Array.isArray(o.lines) ? o.lines.filter((l): l is string => typeof l === "string") : [];
  return { root: o.root, lessons: lines.map(lessonParts) };
}

/** The CLI's JSON (`{own, others, dir}`); junk degrades to an empty tree, never throws. */
export function parseKnow(v: unknown): Know {
  if (!v || typeof v !== "object") return { shared: null, own: null, others: [], dir: null };
  const o = v as { shared?: unknown; own?: unknown; others?: unknown; dir?: unknown };
  return {
    shared: book(o.shared),
    own: book(o.own),
    others: Array.isArray(o.others) ? o.others.map(book).filter((b): b is Book => b != null) : [],
    dir: typeof o.dir === "string" ? o.dir : null,
  };
}

/** One lesson in the merged feed, with the book it came from. */
export type FeedItem = Lesson & { /** "Công ty" for the shared book, else the repo's folder name. */ project: string; root: string; kind: "shared" | "own" | "other" };

const folder = (root: string) => root.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() || root;

/**
 * Every book in one list (owner 2026-10-22: "Tri thức là gom all mà sao ui phân chia"), newest first,
 * each lesson tagged with its project so nothing gets mixed up. Undated lessons go last. Pure.
 */
export function lessonFeed(k: Know): FeedItem[] {
  const out: FeedItem[] = [];
  const add = (b: Book | null, kind: FeedItem["kind"]) => {
    if (!b) return;
    const project = kind === "shared" ? "Công ty" : folder(b.root);
    b.lessons.forEach((l) => out.push({ ...l, project, root: b.root, kind }));
  };
  add(k.shared, "shared");
  add(k.own, "own");
  for (const b of k.others) add(b, "other");
  // Newest day first; within a day, the later line first (books append).
  return out
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (b.x.day ?? "").localeCompare(a.x.day ?? "") || b.i - a.i)
    .map((e) => e.x);
}

/** The feed narrowed to one project ("Công ty" included) and/or a search over text and room. */
export function filterFeed(items: FeedItem[], project: string | null, q: string): FeedItem[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((x) => (project == null || x.project === project) && words.every((w) => `${x.text} ${x.room ?? ""} ${x.project}`.toLowerCase().includes(w)));
}

/** Projects in the feed with their lesson count, "Công ty" first, then by count. */
export function feedProjects(items: FeedItem[]): { project: string; n: number }[] {
  const m = new Map<string, number>();
  for (const x of items) m.set(x.project, (m.get(x.project) ?? 0) + 1);
  return [...m.entries()].map(([project, n]) => ({ project, n })).sort((a, b) => Number(b.project === "Công ty") - Number(a.project === "Công ty") || b.n - a.n || a.project.localeCompare(b.project));
}
