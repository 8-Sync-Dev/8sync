// Questions that sit on screen past the owner's minute while "Chạy liên tục" is on. The delegate hook
// only sees an AskUserQuestion as it is asked; a question asked while the critic was off (auto paused,
// seen live 2026-10-18: 7 rooms for an hour) stayed with the owner for good. HQ hands such a question
// to the critic: `8sync ccc delegate check` applies the same rails (Ship, secrets, money, deploys and
// high-risk stay with the owner), then HQ closes the dialog and tells the room to let the critic pick.
// Pure rules here; the effects live in lib/server/stuck-asks.ts. Tested in tests/stuck-asks.test.ts.
import type { Ask } from "./ask";

export const STUCK_AFTER_MS = 60_000;

export type StuckRoom = { session_id: string | null; cwd: string | null; delivery: "terminal" | "inbox" | null; ask: Ask | null };

/** `handled`: session id → the `at` of the question already handed over (each question once). */
export function stuckAsks<T extends StuckRoom>(rooms: T[], handled: Record<string, number>, now: number): T[] {
  return rooms.filter((r) => {
    const a = r.ask;
    if (!r.session_id || r.delivery !== "inbox" || !a || a.kind !== "question" || a.at == null) return false;
    if (handled[r.session_id] === a.at) return false;
    return now - a.at >= STUCK_AFTER_MS;
  });
}

/** What the room reads once the dialog is closed: the questions, and the critic route the hook would have given. */
export function criticMessage(ask: Extract<Ask, { kind: "question" }>, reason: string): string {
  const qs = ask.questions.map((q, i) => `${i + 1}. ${q.question} [${q.options.map((o) => o.label).join(" | ")}]`).join("\n");
  return `8sync HQ: câu hỏi của phòng này chờ owner quá 60 giây trong lúc "Chạy liên tục" bật, nên HQ đã đóng hộp hỏi. Đừng hỏi lại owner các câu này:\n${qs}\n${reason}`;
}
