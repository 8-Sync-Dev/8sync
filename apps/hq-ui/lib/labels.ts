// Pure display rules for sessions (no React). Tested in tests/labels.test.ts.
import type { Session } from "@/components/hq/types";
import { mainRoot } from "./preview";
import { roomLabel } from "./room-label";

const DAY_MS = 86_400_000;
const UUIDISH = /^[0-9a-f-]{20,}$/i;

/** Readable name: title/label, else hq name without "hq-", else 8-char id. Never a full uuid. */
export function sessionLabel(s: Pick<Session, "label" | "name" | "session_id">): string {
  for (const raw of [s.label, s.name]) {
    const v = raw?.trim();
    if (!v) continue;
    if (UUIDISH.test(v)) continue;
    return roomLabel(v.startsWith("hq-") ? v.slice(3) : v);
  }
  const id = [s.label, s.name, s.session_id].find((x) => x && UUIDISH.test(x.trim()));
  return id ? id.trim().slice(0, 8) : "unknown";
}

/** The project folder a room works in (a worktree counts as its repo): "C:\\r\\su-code\\.claude\\worktrees\\x" -> "su-code". */
export function roomProject(cwd: string | null | undefined): string | null {
  const root = cwd?.trim() ? mainRoot(cwd.trim()).replace(/[\\/]+$/, "") : "";
  return root.split(/[\\/]/).pop() || null;
}

/** Room name plus its project, so several rooms called "core" read apart: "core · su-code". */
export function targetLabel(s: Pick<Session, "label" | "name" | "session_id" | "cwd">): string {
  const name = sessionLabel(s);
  const project = roomProject(s.cwd);
  return project && project.toLowerCase() !== name.toLowerCase() ? `${name} · ${project}` : name;
}

/** The label for a session name or id in messages ("omp-c1f506dd…" → "core · su-code"); null when HQ does not know it. */
export function roomNameOf(sessions: Pick<Session, "label" | "name" | "session_id" | "cwd">[], id: string | null | undefined): string | null {
  if (!id) return null;
  const s = sessions.find((x) => x.name === id || x.session_id === id);
  return s ? targetLabel(s) : null;
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

/**
 * Inbox wording in toasts and summaries. Claude Code: when the task enters depends on whether the
 * `8sync-inbox` mod is loaded. omp (`id` an omp room id): the `8sync-inbox` omp extension takes it within
 * seconds, even mid-turn; `live` false means the session started before the extension was deployed.
 */
export const INBOX_LIVE_TEXT = "qua inbox (nhận ngay khi phiên rảnh)";
export const INBOX_STOP_TEXT = "qua inbox (nhận khi xong lượt — gõ /reload-plugins trong phiên để nhận ngay)";
export const INBOX_OMP_TEXT = "qua inbox (omp nhận trong vài giây, kể cả khi đang làm)";
export const INBOX_OMP_OLD_TEXT = "qua inbox (phiên omp này mở trước khi có 8sync-inbox: thoát rồi mở lại phiên để nhận tin)";

export function inboxText(live: boolean | undefined, id?: string | null): string {
  if (id && isOmpRoomId(id)) return live ? INBOX_OMP_TEXT : INBOX_OMP_OLD_TEXT;
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

// loop.json `stopped` (eccx-loop / `8sync ccc cancel`) in the owner's words: Vòng lặp and Báo cáo
// showed the raw "dừng: done" / "dừng: no-change" (UI audit 2026-11-07).
const LOOP_STOP: Record<string, string> = {
  done: "xong",
  "no-change": "dừng: không còn thay đổi",
  stuck: "dừng: bị kẹt",
  "max-iter": "dừng: hết lượt",
  "max-min": "dừng: hết giờ",
  cancelled: "đã huỷ",
  corrupt: "dừng: loop.json hỏng",
};

/** "xong" / "dừng: hết lượt" / "dừng: <raw>" for a reason this table does not know yet. */
export function loopStop(stopped: string): string {
  return LOOP_STOP[stopped] ?? `dừng: ${stopped}`;
}
