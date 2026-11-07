// What `graphify explain` and `graphify path` print, read into data for the "Bản đồ code" tab's
// cards (components/hq/codemap-ask.tsx). Pure: the server (app/api/codemap/graphify) parses, the
// browser renders. Samples captured from graphify on this repo: tests/fixtures/graphify/*.txt,
// tested in tests/graphify-answer.test.ts. Anything these do not recognise stays plain text.

/** A file and line as graphify prints them: `apps/x.ts:L17` (a link) or `apps/x.ts L164` (a node's source). */
export type Where = { file: string; line: number | null };

/** One edge of an explained node: `<--` points at it (a caller, an importer), `-->` from it (a callee). */
export type Link = { dir: "in" | "out"; name: string; relation: string; confidence: string; where: Where | null };

export type ExplainAnswer = {
  kind: "explain";
  name: string;
  id: string | null;
  where: Where | null;
  type: string | null;
  degree: number | null;
  /** `calls` edges into the node. */
  callers: Link[];
  /** `calls` edges out of the node. */
  callees: Link[];
  /** Everything else: contains, imports, uses… */
  related: Link[];
  /** Connections graphify did not list (`... and N more`). */
  more: number;
};

export type PathStep = { name: string; via: { relation: string; confidence: string; back: boolean } | null };
export type PathAnswer = { kind: "path"; hops: number; steps: PathStep[]; confidence: string | null };

export type GraphifyAnswer =
  | ExplainAnswer
  | PathAnswer
  /** A name matched nodes in several files: pick one by its id. */
  | { kind: "ambiguous"; query: string; candidates: { file: string; id: string }[] }
  | { kind: "missing"; query: string }
  | { kind: "nopath"; from: string; to: string }
  | { kind: "text"; text: string };

const lines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");

/** `apps/x.ts:L17`, `apps/x.ts L164`, `apps/x.ts`: the file and line, or null when there is no file. */
export function parseWhere(raw: string | undefined): Where | null {
  const s = raw?.trim();
  if (!s) return null;
  const m = /^(.*?)(?::L| L)(\d+)$/.exec(s);
  return m && m[1] ? { file: m[1], line: Number(m[2]) } : { file: s, line: null };
}

const LINK = /^(<--|-->)\s+(.+)\s+\[([^\]]+)\]\s+\[([A-Za-z_]+)\](?:\s+(\S.*))?$/;

/** `graphify explain X`: the node, its fields, and its connections split into callers / callees / the rest. */
export function parseExplain(text: string): ExplainAnswer | null {
  const ls = lines(text);
  const head = /^Node:\s*(.+?)\s*$/.exec(ls[0] ?? "");
  if (!head) return null;
  const field = new Map<string, string>();
  const out: ExplainAnswer = { kind: "explain", name: head[1], id: null, where: null, type: null, degree: null, callers: [], callees: [], related: [], more: 0 };
  let inLinks = false;
  for (const raw of ls.slice(1)) {
    const l = raw.trim();
    if (!inLinks) {
      if (/^Connections \(\d+\):$/.test(l)) {
        inLinks = true;
        continue;
      }
      const f = /^([A-Za-z]+):\s*(.*)$/.exec(l);
      if (f) field.set(f[1].toLowerCase(), f[2].trim());
      continue;
    }
    const more = /^\.\.\. and (\d+) more\b/.exec(l);
    if (more) {
      out.more = Number(more[1]);
      continue;
    }
    // "Grouped by file:" and its rows close the list.
    if (/^Grouped by file:/.test(l)) break;
    const m = LINK.exec(l);
    if (!m) continue;
    const link: Link = { dir: m[1] === "<--" ? "in" : "out", name: m[2].trim(), relation: m[3], confidence: m[4], where: parseWhere(m[5]) };
    if (link.relation === "calls") (link.dir === "in" ? out.callers : out.callees).push(link);
    else out.related.push(link);
  }
  out.id = field.get("id") || null;
  out.where = parseWhere(field.get("source"));
  out.type = field.get("type") || null;
  const degree = field.get("degree") ?? "";
  out.degree = /^\d+$/.test(degree) ? Number(degree) : null;
  return out;
}

// One hop inside a path line: ` --calls [EXTRACTED]--> ` (or `<--calls [X]-- ` should graphify print a reversed edge).
const HOP = /\s(<)?--(\S+?) \[([A-Za-z_]+)\]--(>)?\s/g;

/** `graphify path A B`: the nodes in order with the edge that leads to each. */
export function parsePath(text: string): PathAnswer | null {
  const ls = lines(text);
  const i = ls.findIndex((l) => /^Shortest path \(\d+ hops?\):/.test(l.trim()));
  if (i < 0) return null;
  const hops = Number(/\((\d+) hops?\)/.exec(ls[i])![1]);
  const row = ls[i + 1]?.trim() ?? "";
  if (!row) return null;
  const steps: PathStep[] = [];
  let at = 0;
  let via: PathStep["via"] = null;
  for (const m of row.matchAll(HOP)) {
    steps.push({ name: row.slice(at, m.index).trim(), via });
    via = { relation: m[2], confidence: m[3], back: m[1] === "<" && m[4] !== ">" };
    at = m.index + m[0].length;
  }
  steps.push({ name: row.slice(at).trim(), via });
  if (steps.some((s) => !s.name) || steps.length < 2) return null;
  const conf = ls.slice(i + 2).map((l) => /^Path confidence:\s*([A-Za-z_]+)/.exec(l.trim())).find(Boolean);
  return { kind: "path", hops, steps, confidence: conf?.[1] ?? null };
}

/** `Ambiguous: 'open()' matches 6 nodes …` then `  <file>` / `    id: <id>` pairs. */
export function parseAmbiguous(text: string): GraphifyAnswer | null {
  const ls = lines(text);
  const head = /^Ambiguous: '(.*)' matches \d+ nodes?/.exec(ls[0]?.trim() ?? "");
  if (!head) return null;
  const candidates: { file: string; id: string }[] = [];
  let file: string | null = null;
  for (const raw of ls.slice(1)) {
    const l = raw.trim();
    const id = /^id:\s*(\S+)$/.exec(l);
    if (id && file != null) {
      candidates.push({ file, id: id[1] });
      file = null;
    } else if (l && !l.startsWith("Retry with")) file = l;
  }
  return candidates.length ? { kind: "ambiguous", query: head[1], candidates } : null;
}

/** Whatever graphify printed for `action`, as the card to show; plain text when it is none of these. */
export function parseGraphify(action: "explain" | "path", text: string): GraphifyAnswer {
  const t = text.trim();
  const amb = parseAmbiguous(t);
  if (amb) return amb;
  const missing = /^No node matching '(.*)' found\.?$/m.exec(t);
  if (missing) return { kind: "missing", query: missing[1] };
  const none = /^No (?:directed )?path found between '(.*)' and '(.*)'\./m.exec(t);
  if (none) return { kind: "nopath", from: none[1], to: none[2] };
  return (action === "explain" ? parseExplain(t) : parsePath(t)) ?? { kind: "text", text: t };
}

/** How graphify's relations read in the tab. */
export const RELATION_VI: Readonly<Record<string, string>> = {
  calls: "gọi",
  imports: "import",
  imports_from: "import",
  contains: "chứa",
  method: "phương thức",
  inherits: "kế thừa",
  uses: "dùng",
  references: "nhắc tới",
};
export const relationVi = (r: string) => (Object.hasOwn(RELATION_VI, r) ? RELATION_VI[r] : r.replace(/_/g, " "));

/** Confidence words; EXTRACTED (read straight from the code) is the default and not shown. */
export const CONFIDENCE_VI: Readonly<Record<string, string>> = { INFERRED: "suy ra", AMBIGUOUS: "chưa chắc" };
