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

// "/" commands (owner 2026-11-02): a "/" that starts a line lists the owner's omp and Claude Code
// commands (GET /api/commands, lib/server/commands.ts); picking one puts "/name " in its place.

export type SlashCommand = { name: string; description: string; source: "omp" | "claude" };
/** The "/token" under the caret: `start` is the index of "/", `prefix` what follows it. */
export type Slash = { start: number; end: number; prefix: string };

/** A "/…" at the start of a line, running to the caret with no space in it. */
export function slashAt(text: string, caret: number): Slash | null {
  const m = /(^|\n)\/([\w.:-]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2].length - 1, end: caret, prefix: m[2] } : null;
}

/** Commands whose name starts with the prefix, then those that contain it (case-insensitive). */
export function filterCommands(cmds: SlashCommand[], prefix: string, max = 8): SlashCommand[] {
  const p = prefix.toLowerCase();
  const starts = cmds.filter((c) => c.name.toLowerCase().startsWith(p));
  const has = cmds.filter((c) => !c.name.toLowerCase().startsWith(p) && c.name.toLowerCase().includes(p));
  return [...starts, ...has].slice(0, max);
}

/** Put "/name " in place of the "/token". */
export function applyCommand(text: string, s: Slash, c: SlashCommand): { text: string; caret: number } {
  const rest = text.slice(s.end);
  const head = `${text.slice(0, s.start)}/${c.name}${rest.startsWith(" ") ? "" : " "}`;
  return { text: head + rest, caret: head.length };
}
