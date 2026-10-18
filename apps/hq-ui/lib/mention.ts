// "@path" in the HQ composers (owner 2026-10-18): type @ to pick a file or folder of the project, `../`
// to walk out of it. Pure rules; the listing is GET /api/fs, the send turns each @path into an absolute
// one (lib/server/fs-list.ts expandMentions) so a room in a worktree or another folder can Read it.
// Tested in tests/mention.test.ts.

export type Entry = { name: string; dir: boolean };
/** The @token under the caret: `start` is the index of "@", `dir` the part up to the last "/", `prefix` the rest. */
export type Mention = { start: number; end: number; dir: string; prefix: string };

/** An "@…" that starts the text or follows whitespace, and runs to the caret with no space in it. */
export function mentionAt(text: string, caret: number): Mention | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  const token = m[2];
  const start = caret - token.length - 1;
  const slash = token.lastIndexOf("/");
  return { start, end: caret, dir: slash >= 0 ? token.slice(0, slash + 1) : "", prefix: slash >= 0 ? token.slice(slash + 1) : token };
}

/** Entries matching what was typed after the last "/": prefix first, then substring; ".." to go up. */
export function filterEntries(entries: Entry[], prefix: string, max = 12): Entry[] {
  const p = prefix.toLowerCase();
  const up: Entry[] = !p || "..".startsWith(p) ? [{ name: "..", dir: true }] : [];
  const starts = entries.filter((e) => e.name.toLowerCase().startsWith(p));
  const has = entries.filter((e) => !e.name.toLowerCase().startsWith(p) && e.name.toLowerCase().includes(p));
  return [...up, ...starts, ...has].slice(0, max);
}

/** Put the picked entry in place of the @token. A folder keeps the list open one level down. */
export function applyPick(text: string, m: Mention, e: Entry): { text: string; caret: number; open: boolean } {
  const path = `${m.dir}${e.name}${e.dir ? "/" : ""}`;
  const rest = text.slice(m.end);
  const tail = e.dir ? "" : rest.startsWith(" ") ? "" : " ";
  const head = `${text.slice(0, m.start)}@${path}${tail}`;
  return { text: head + rest, caret: head.length, open: e.dir };
}
