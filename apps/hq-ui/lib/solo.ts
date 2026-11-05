// `/solo` state as HQ shows it: the header of `su-code/ship/solo/SOLO.md` (contract with the kit's
// /solo skill) plus whether `solo` is a line of `su-code/ship/ACTIVE`. Pure; the file read lives in
// lib/server/solo.ts. Tested in tests/solo.test.ts.
//
//   Status: running|waiting|stopped
//   Item: <current item or ->
//   Question: <pending question or ->
//   Updated: <ISO-8601 UTC>
//   Deadline: <ISO-8601 UTC or ->      (when the Critic answers for the owner)
//   Options: <first = recommended> | <label> | ...   (or -)
//
//   - <ISO> <event>   (append-only log: asked "<q>" options: …, owner chose "<l>", critic chose "<l>": <why>, …)
import { maskSecrets } from "./mask";

export type SoloStatus = "running" | "waiting" | "stopped";
/**
 * One log line. `asked`: `question` + `options` of that ask. `critic` / `owner`: the `label` chosen
 * (`reason`: the Critic's why) and the `question` + `options` of the ask it answered (for "Đổi").
 */
export type SoloLog = {
  at: number | null;
  text: string;
  kind: "critic" | "owner" | "asked" | "event";
  label: string | null;
  reason: string | null;
  question: string | null;
  options: string[];
};
export type Solo = {
  status: SoloStatus;
  item: string | null;
  question: string | null;
  /** First = the one /solo recommends (the Critic's default). */
  options: string[];
  updated: number | null;
  /** When the Critic answers if the owner has not (ms). */
  deadline: number | null;
  /** The newest log lines, oldest first. */
  log: SoloLog[];
};

/** Log lines kept for the card (it shows fewer). */
export const SOLO_LOG_MAX = 12;
const TEXT_MAX = 600;
const LABEL_MAX = 200;
const OPTIONS_MAX = 8;

/** A header value; "-" and blank mean none. */
const none = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return !t || t === "-" ? null : t;
};
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const clean = (s: string, max = TEXT_MAX) => cut(maskSecrets(s.slice(0, max + 256)), max);
const time = (v: string | null): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** `a | b | c` → labels, the " (Recommended)" suffix of the log form dropped. */
export function soloOptions(v: string | null): string[] {
  if (!v) return [];
  return v
    .split(" | ")
    .map((s) => s.trim().replace(/\s*\(Recommended\)$/i, ""))
    .filter((s) => s && s !== "-")
    .slice(0, OPTIONS_MAX)
    .map((s) => clean(s, LABEL_MAX));
}

function logLine(raw: string): SoloLog {
  const m = /^(\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:?\d{2}))\s+(.*)$/.exec(raw);
  const at = m ? time(m[1]) : null;
  const rest = (m ? m[2] : raw).trim();
  const line = { at, text: clean(rest), label: null, reason: null, question: null, options: [] };
  const chose = /^(critic|owner) chose "([^"]*)"(?::\s*(.*))?$/i.exec(rest);
  if (chose) {
    const kind = chose[1].toLowerCase() === "critic" ? "critic" : "owner";
    return { ...line, kind, label: clean(chose[2], LABEL_MAX), reason: chose[3] ? clean(chose[3]) : null };
  }
  // `asked "<q>"` or `asked "<q>" options: a (Recommended) | b` (the question holds no `"`).
  const asked = /^asked "([^"]*)"(?:\s+options:\s*(.*))?$/i.exec(rest);
  if (asked) return { ...line, kind: "asked", question: clean(asked[1]), options: soloOptions(asked[2] ?? null) };
  return { ...line, kind: "event" };
}

/** SOLO.md → its state; null when the header has no `Status:` line (not a /solo file). Lenient: CRLF, any key order, unknown keys. */
export function parseSoloMd(md: string): Solo | null {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const head: Record<string, string> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) {
      if (Object.keys(head).length) break;
      continue;
    }
    const m = /^([A-Za-z][A-Za-z-]*):\s?(.*)$/.exec(l);
    if (!m) break;
    const k = m[1].toLowerCase();
    if (!(k in head)) head[k] = m[2];
  }
  const st = (head.status ?? "").trim().toLowerCase();
  if (!st) return null;
  const status: SoloStatus = st === "running" || st === "waiting" ? st : "stopped";
  let ask: SoloLog | null = null;
  const log = lines
    .slice(i)
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+\S/.test(l))
    .map((l) => {
      const e = logLine(l.replace(/^[-*]\s+/, ""));
      if (e.kind === "asked") ask = e;
      else if ((e.kind === "critic" || e.kind === "owner") && ask) return { ...e, question: ask.question, options: ask.options };
      return e;
    });
  let options = soloOptions(none(head.options));
  // No `Options:` header: the asked line carries them too.
  if (!options.length && status === "waiting") options = [...log].reverse().find((l) => l.kind === "asked")?.options ?? [];
  const item = none(head.item);
  const question = none(head.question);
  return {
    status,
    item: item && clean(item),
    question: question && clean(question),
    options,
    updated: time(none(head.updated)),
    deadline: time(none(head.deadline)),
    log: log.slice(-SOLO_LOG_MAX),
  };
}

/** `su-code/ship/ACTIVE`: one slug per line; `/solo` is on while `solo` is one of them. */
export function soloActive(active: string | null): boolean {
  if (!active) return false;
  return active.split(/\r?\n/).some((l) => l.trim().split(/\s+/)[0] === "solo");
}

/** What the card shows: a waiting question only while /solo is registered; off the ACTIVE list it is stopped. */
export function soloState(solo: Solo | null, active: boolean): SoloStatus {
  if (!active || !solo) return "stopped";
  return solo.status;
}

export const SOLO_LABEL: Record<SoloStatus, string> = { running: "Đang chạy", waiting: "Chờ anh chọn", stopped: "Đã dừng" };

export type SoloAction = "start" | "stop" | "answer" | "override";
export const SOLO_ACTIONS: readonly SoloAction[] = ["start", "stop", "answer", "override"];
/** Where the kit installs the skill (a slash that comes through the inbox does not expand: the room is told to read it). */
export const SOLO_SKILL = "~/.claude/skills/solo/SKILL.md";

/**
 * The message HQ sends into the /solo room; the skill reads it, also inside HQ's inbox framing.
 * start: `/solo`; stop: `dừng`; answer: `solo: <label or text>`; override (a Critic pick): `solo: override <label>`.
 */
export function soloMessage(action: SoloAction, answer: string, delivery: "terminal" | "inbox" | null): string {
  if (action === "start") return delivery === "inbox" ? `/solo\n(Lệnh slash tới qua inbox nên không tự chạy: đọc ${SOLO_SKILL} và làm theo, $ARGUMENTS = "".)` : "/solo";
  if (action === "stop") return "dừng";
  return action === "override" ? `solo: override ${answer}` : `solo: ${answer}`;
}

/** "Critic sẽ chọn sau N phút" while the deadline is ahead; null when there is none or it passed. */
export function criticIn(deadline: number | null, now: number): string | null {
  if (deadline == null || !now) return null;
  const left = deadline - now;
  if (left <= 0) return null;
  const min = Math.ceil(left / 60_000);
  return min >= 60 ? `Critic sẽ chọn sau ${Math.floor(min / 60)} giờ ${min % 60 ? `${min % 60} phút` : ""}`.trim() : `Critic sẽ chọn sau ${min} phút`;
}
