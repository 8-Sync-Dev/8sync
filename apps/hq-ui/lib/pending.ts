// Pending questions / permission prompts (contract C5): shared types and pure display rules
// for the "Đang chờ anh" strip. Server side: lib/server/pending.ts. Tested in tests/pending.test.ts.

export type PendingOption = { label: string; description: string };
export type PendingQuestion = { question: string; header: string; options: PendingOption[]; multiSelect: boolean };

export type Pending = {
  id: string;
  kind: "question" | "permission";
  session_id: string | null;
  cwd: string | null;
  /** Room name the hook knew (named session), else null. */
  room: string | null;
  created: number;
  /** Unix ms: the hook stops waiting then and applies `fallback`. */
  deadline: number;
  questions: PendingQuestion[];
  tool: string | null;
  summary: string | null;
  /** Ship / secret / delete / money / deploy class: the critic never answers it. */
  owner_only: boolean;
  fallback: "critic" | "deny" | "dialog";
};

/** What happens if the owner does not answer in time. */
export function fallbackText(p: Pick<Pending, "fallback">): string {
  if (p.fallback === "critic") return "critic tự chọn";
  if (p.fallback === "dialog") return "hiện hộp thoại trong terminal";
  return "tự từ chối";
}

/** "4:05" left until the deadline; "0:00" once it passed. */
export function countdown(deadline: number, now = Date.now()): string {
  const s = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The room as the owner reads it: hook room name, else the last folder of the cwd, else 8 id chars. */
export function pendingRoom(p: Pick<Pending, "room" | "cwd" | "session_id">): string {
  if (p.room?.trim()) return p.room.trim();
  const dir = p.cwd?.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  return dir || p.session_id?.slice(0, 8) || "phòng ?";
}

/**
 * One question's answer string: the picked labels plus the "Khác" free text, ", "-joined (the
 * shape Claude Code's own dialog returns for multi-select; single-select keeps one of the two). "" = unanswered.
 */
export function answerOf(picked: string[], other: string): string {
  return [...picked, other.trim()].filter(Boolean).join(", ");
}
