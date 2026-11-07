// The context line HQ puts above a room's message to another room, right under its source line
// (lib/sender.ts `[phòng web]`, hq.rs `[phòng web → core · /r]`): who sent it and what that room is on,
// `[từ phòng <label> · <project> · đang: <doing>]`. Context only, never authority: the ship grant reads
// the first line alone, and this line is never first. The recipient reads the rest with `hq.mjs brief`.
// Pure, shared by the server (messages route) and the timeline (lib/room-turns.ts promptBody).

export type RoomContext = { label: string; project: string | null; doing: string | null };

const LABEL_MAX = 48;
const PROJECT_MAX = 48;
const DOING_MAX = 100;

/** One field as the line may show it: one line, no bracket or separator, capped (`…` when cut). */
function field(s: string | null | undefined, max: number): string {
  const t = (s ?? "").replace(/[\p{Cc}\p{Cf}[\]·]/gu, " ").split(/\s+/).filter(Boolean).join(" ");
  const cs = [...t];
  return cs.length > max ? `${cs.slice(0, max - 1).join("")}…` : t;
}

/** The line, or null when there is no sender name to show. */
export function contextLine(c: RoomContext): string | null {
  const label = field(c.label, LABEL_MAX);
  if (!label) return null;
  const project = field(c.project, PROJECT_MAX);
  const doing = field(c.doing, DOING_MAX);
  return `[từ phòng ${label}${project && project.toLowerCase() !== label.toLowerCase() ? ` · ${project}` : ""}${doing ? ` · đang: ${doing}` : ""}]`;
}

const LINE = /^\[từ phòng ([^\]\n·]+?)(?: · (?!đang: )([^\]\n·]+?))?(?: · đang: ([^\]\n]+?))?\]$/;
/** A leading context line, or the `[từ phòng X] ` prefix older /hq-send copies type on the message's first line. */
const LEAD = /^\[từ phòng [^\]\n]*\][ \t]*\n?/;

/** `[từ phòng …]` back into its fields; null for any other line. */
export function parseContextLine(line: string): RoomContext | null {
  const m = LINE.exec(line.trim());
  return m ? { label: m[1], project: m[2] ?? null, doing: m[3] ?? null } : null;
}

/** `text` without a leading context line (one a room typed itself, or HQ's). */
export function stripContextLine(text: string): string {
  return text.replace(LEAD, "");
}

/** `text` as the recipient gets it: the sender's context line (replacing one it typed) above its words. */
export function withContext(text: string, c: RoomContext | null): string {
  const line = c && contextLine(c);
  return line ? `${line}\n${stripContextLine(text)}` : text;
}
