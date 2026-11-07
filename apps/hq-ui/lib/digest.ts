// "Ai đang làm gì": what one bot learns about the others at the start of a turn the owner gives it
// (BRIEF section 3, Grok Bot's shared state). Built from what HQ already has, the office rooms (label,
// project, status, step, open question) and the owner's shared facts (lib/server/facts.ts): no
// transcript read, no model call. At most DIGEST_LINES lines and DIGEST_CHARS characters, every field
// one line, masked (lib/mask.ts) and stripped of brackets, so a room's title cannot pose as HQ's frame.
// The order is by status then name, never by time: the same picture gives the same text, and
// lib/server/digest.ts skips a digest the bot already has. Pure; tested in tests/context.test.ts.
import { askLine, BOT_STATUS_LABEL, botNames, botProject, botStatus, type BotRoom, type BotStatus } from "./bots";
import { DIGEST_HEAD } from "./digest-frame";
import { maskSecrets } from "./mask";

export const DIGEST_LINES = 10;
export const DIGEST_CHARS = 1200;
/** The shared facts' line: the rest is one `hq.mjs facts` away. */
const FACTS_CHARS = 300;
const CAP = { name: 40, project: 40, doing: 80, waiting: 70, row: 200 } as const;
const RANK: Record<BotStatus, number> = { needs: 0, error: 1, working: 2, idle: 3 };

export type DigestRoom = Pick<BotRoom, "key" | "name" | "session_id" | "label" | "status" | "waiting" | "ask" | "cwd" | "project" | "doing" | "state">;

/** One field: secrets masked, one line, no bracket or `·` (they frame the digest), cut at `max` with `…`. */
export function digestField(s: string | null | undefined, max: number): string {
  const t = maskSecrets((s ?? "").slice(0, max + 256))
    .replace(/[\p{Cc}\p{Cf}[\]·]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cs = [...t];
  return cs.length > max ? `${cs.slice(0, max - 1).join("")}…` : t;
}

const len = (s: string) => [...s].length;
const total = (lines: readonly string[]) => lines.reduce((n, l) => n + len(l), 0) + Math.max(0, lines.length - 1);

/** The facts line, cut at FACTS_CHARS with where to read them all. */
function factsLine(facts: readonly string[]): string | null {
  const shown = facts.map((f) => digestField(f, 160)).filter(Boolean);
  if (!shown.length) return null;
  const line = `Fact chung: ${shown.join(" · ")}`;
  return len(line) > FACTS_CHARS ? `${[...line].slice(0, FACTS_CHARS - 24).join("")}… (đủ: hq.mjs facts)` : line;
}

/**
 * The digest bot `self` (a room address or session id) gets: the head line, the shared facts, then one
 * line per other live bot (name · status · project · step · what it waits on), the overflow counted on
 * the last line. null when there is nothing to tell (no other bot, no fact).
 */
export function buildDigest(rooms: readonly DigestRoom[], self: string, facts: readonly string[] = []): string | null {
  const live = rooms.filter((r) => r.status !== "ended");
  const names = botNames(live);
  const labels = new Map<string, number>();
  for (const r of live) labels.set(r.label.toLowerCase(), (labels.get(r.label.toLowerCase()) ?? 0) + 1);
  const rows = live
    .filter((r) => r.name !== self && r.session_id !== self)
    .map((r) => {
      const n = names.get(r.key) ?? { name: r.label, qualifier: null };
      const status = botStatus(r);
      const project = botProject(r);
      const where = project ? `${project}${r.project?.branch ? `@${r.project.branch}` : ""}` : "";
      const waiting = status === "needs" ? (askLine(r.ask) ?? r.waiting ?? "đang chờ anh trả lời") : null;
      const parts = [
        digestField(n.name, CAP.name),
        // A label several rooms share does not name one for `hq.mjs turns`: its address does (kept before the
        // cut; HQ's own id, never masked: a session uuid looks opaque to the masker).
        (labels.get(r.label.toLowerCase()) ?? 0) > 1 ? `id ${r.name}` : "",
        BOT_STATUS_LABEL[status].toLowerCase(),
        digestField(where, CAP.project),
        r.doing ? `việc: ${digestField(r.doing, CAP.doing)}` : "",
        waiting ? `chờ: ${digestField(waiting, CAP.waiting)}` : "",
      ].filter(Boolean);
      const line = [...`- ${parts.join(" · ")}`];
      return { rank: RANK[status], name: n.name.toLowerCase(), key: r.key, line: line.length > CAP.row ? `${line.slice(0, CAP.row - 1).join("")}…` : line.join("") };
    })
    .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
    .map((r) => r.line);
  const fl = factsLine(facts);
  if (!rows.length && !fl) return null;
  const head = fl ? [DIGEST_HEAD, fl] : [DIGEST_HEAD];
  let k = Math.min(rows.length, DIGEST_LINES - head.length);
  if (k < rows.length) k = DIGEST_LINES - head.length - 1;
  const build = (k: number) => [...head, ...rows.slice(0, k), ...(k < rows.length ? [`+${rows.length - k} bot khác: hq.mjs roster`] : [])];
  while (k > 0 && total(build(k)) > DIGEST_CHARS) k--;
  return build(k).join("\n");
}
