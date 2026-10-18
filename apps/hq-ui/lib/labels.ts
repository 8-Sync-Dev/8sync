// Pure display rules for sessions (no React). Tested in tests/labels.test.ts.
import type { Session } from "@/components/hq/types";

const DAY_MS = 86_400_000;
const UUIDISH = /^[0-9a-f-]{20,}$/i;

/** Readable name: title/label, else hq name without "hq-", else 8-char id. Never a full uuid. */
export function sessionLabel(s: Pick<Session, "label" | "name" | "session_id">): string {
  for (const raw of [s.label, s.name]) {
    const v = raw?.trim();
    if (!v) continue;
    if (UUIDISH.test(v)) continue;
    return v.startsWith("hq-") ? v.slice(3) : v;
  }
  const id = [s.label, s.name, s.session_id].find((x) => x && UUIDISH.test(x.trim()));
  return id ? id.trim().slice(0, 8) : "unknown";
}

/**
 * Idle for over a day (or ended) collapses in the nav. started_at is the only
 * timestamp the API row carries, so it is the proxy for "last seen".
 * Sessions that need the owner or are running never collapse.
 */
export function isStale(s: Pick<Session, "status" | "started_at" | "waiting">, now = Date.now()): boolean {
  if (s.waiting) return false;
  if (s.status === "ended") return true;
  if (s.status !== "idle") return false;
  return s.started_at != null && now - s.started_at > DAY_MS;
}

export function splitStale<T extends Pick<Session, "status" | "started_at" | "waiting">>(
  sessions: T[],
  now = Date.now(),
): { fresh: T[]; stale: T[] } {
  const fresh: T[] = [];
  const stale: T[] = [];
  for (const s of sessions) (isStale(s, now) ? stale : fresh).push(s);
  return { fresh, stale };
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** omp room id (contract C3): `omp-` + 16 lowercase hex, made by the Rust `room_id`. */
const OMP_ROOM_ID = /^omp-[0-9a-f]{16}$/;

export function isOmpRoomId(s: unknown): s is string {
  return typeof s === "string" && OMP_ROOM_ID.test(s);
}

/**
 * How an owner message reaches a session: typed into its hq-* tmux pane, or queued in its
 * inbox (any Claude Code session started elsewhere, all of Windows, every omp room).
 */
export function deliveryOf(s: Pick<Session, "tmux" | "name" | "session_id">): "terminal" | "inbox" | null {
  if (s.tmux) return "terminal";
  const id = s.session_id ?? s.name;
  return id && (SESSION_ID.test(id) || isOmpRoomId(id)) ? "inbox" : null;
}

/** Team label of a room: "Đội ccc" / "Đội omp" (absent engine = a Claude Code room). */
export const teamLabel = (engine: string | null | undefined) => `Đội ${engine === "claude" || !engine ? "ccc" : engine}`;

/** Inbox wording in toasts and summaries: when the task enters depends on whether the mod is loaded. */
export const INBOX_LIVE_TEXT = "qua inbox (nhận ngay khi phiên rảnh)";
export const INBOX_STOP_TEXT = "qua inbox (nhận khi xong lượt — gõ /reload-plugins trong phiên để nhận ngay)";

export function inboxText(live: boolean | undefined): string {
  return live ? INBOX_LIVE_TEXT : INBOX_STOP_TEXT;
}

/** What the message/task APIs address a session by: the Claude session id for inbox delivery, else its name. */
export function addressOf(s: Pick<Session, "tmux" | "name" | "session_id">): string {
  return deliveryOf(s) === "inbox" ? (s.session_id ?? s.name) : s.name;
}

/** Sessions the composer can message: every live session HQ can reach. Empty: show the start CTA. */
export function messageTargets<T extends Pick<Session, "tmux" | "status" | "name" | "session_id">>(sessions: T[]): T[] {
  return sessions.filter((s) => s.status !== "ended" && deliveryOf(s) !== null);
}
