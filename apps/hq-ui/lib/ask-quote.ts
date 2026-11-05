import { matchesSession } from "./office";
import { rootKey } from "./preview";

// "Hỏi về đoạn này": the owner selects part of a result and the room's composer gets it as a markdown
// quote with where it came from, ready for the question under it. Pure: shared by the view and tests.

/** The quoted part stops here (the composer holds 4 000 characters; the question needs room too). */
export const QUOTE_MAX = 1500;
/** The composer's own limit (team-view Composer maxLength). */
export const COMPOSER_MAX = 4000;
/** A reference (turn title, file name) longer than this is cut. */
const REF_MAX = 120;

/**
 * `Về «ref»:` then each selected line as `> line` (an empty line as `>`), then a blank line for the
 * question. Windows line ends become `\n`, runs of blank lines fold to one, the text is cut at QUOTE_MAX
 * with "…". Empty when the selection holds nothing but whitespace.
 */
export function quoteForAsk(selected: string, ref: string | null): string {
  let body = selected.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return "";
  if (body.length > QUOTE_MAX) body = `${body.slice(0, QUOTE_MAX).trimEnd()}…`;
  const quoted = body
    .split("\n")
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
  const r = ref ? ref.replace(/\s+/g, " ").trim() : "";
  const head = r ? `Về «${r.length > REF_MAX ? `${r.slice(0, REF_MAX - 1)}…` : r}»:\n` : "";
  return `${head}${quoted}\n\n`;
}

/** The composer's text with `quote` added: alone when it was empty, else after what was there and a blank line; never past COMPOSER_MAX. */
export function withQuote(current: string, quote: string): string {
  const before = current.trimEnd();
  const next = before ? `${before}\n\n${quote}` : quote;
  return next.slice(0, COMPOSER_MAX);
}

/** At most this many file references are picked out of one result. */
export const FILE_REFS_MAX = 8;

/**
 * Files a result names: absolute Windows paths (`C:\x\a.md`, `C:/x/a.md`), and inside backticks also
 * POSIX absolute and relative paths with an extension (`apps/hq-ui/lib/x.ts`). URLs, globs and bare
 * names (`x.ts` with no folder) are skipped. In order of first mention, without repeats.
 */
export function fileRefsIn(text: string): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const p = raw.replace(/[),.;:!?»"']+$/, "").replace(/:\d+(?::\d+)?$/, "");
    if (!/\.[A-Za-z0-9]{1,8}$/.test(p) || /[*?<>|]/.test(p) || /^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return;
    if (!/[\\/]/.test(p)) return;
    if (!out.includes(p) && out.length < FILE_REFS_MAX) out.push(p);
  };
  for (const m of text.matchAll(/`([^`\n]{3,400})`/g)) {
    const s = m[1].trim();
    if (/\s/.test(s) && !/^[A-Za-z]:[\\/]/.test(s)) continue;
    if (/^(?:[A-Za-z]:[\\/]|\/|\.{0,2}[\\/]?[\w@.-]+[\\/])/.test(s)) add(s);
  }
  for (const m of text.matchAll(/(?<![\w`])[A-Za-z]:[\\/][^\s`"'<>|*?]+/g)) add(m[0]);
  return out;
}

type AskRoom = { name: string; session_id: string | null; label?: string | null; status: string; cwd: string | null; project: { root: string } | null; last_active: number | null };

/**
 * The room a question about a result goes to: the live room that made it, else the project's most recently
 * active live room (the one the file is about, `--for`, before the repo it sits in); null when none is live.
 */
export function askRoomFor<R extends AskRoom>(a: { session: string | null; root: string; for_root: string | null }, rooms: R[]): R | null {
  const live = rooms.filter((r) => r.status !== "ended");
  const own = a.session ? live.find((r) => matchesSession(r, a.session)) : undefined;
  if (own) return own;
  const recent = [...live].sort((x, y) => (y.last_active ?? 0) - (x.last_active ?? 0));
  for (const root of [a.for_root, a.root]) {
    if (!root) continue;
    const k = rootKey(root);
    const hit = recent.find((r) => {
      const at = r.project?.root ?? r.cwd;
      return at != null && rootKey(at) === k;
    });
    if (hit) return hit;
  }
  return null;
}
