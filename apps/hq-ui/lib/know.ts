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
