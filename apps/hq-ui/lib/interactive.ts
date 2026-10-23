/**
 * An interactive Claude Code session (`claude agents --json` kind "interactive") runs in the owner's own
 * terminal window, not in the background: `claude attach` answers "No job matching" for it. HQ never
 * opens its terminal and never reads that answer as "the room is gone" (owner 2026-10-23: "ccc mở
 * không xem được" — HQ said "Phiên đã tắt hẳn" and closed a live session).
 */
export function interactiveHint(label: string): string {
  return `\`${label}\` là phiên mở tay trong cửa sổ terminal của anh, không chạy nền: trả lời ngay trong cửa sổ đó.`;
}

type TermTarget = { label: string; interactive?: boolean };

/** Whether HQ may open the room's terminal bridge (`claude attach`); interactive sessions: 409 with the hint. */
export function termGate(s: TermTarget): { ok: true } | { ok: false; status: 409; error: string } {
  return s.interactive ? { ok: false, status: 409, error: interactiveHint(s.label) } : { ok: true };
}

/** A terminal that proved its room gone ends the room's row: only a background room, never an interactive one. */
export function endsWhenDead(s: { interactive?: boolean }, dead: boolean): boolean {
  return dead && !s.interactive;
}
