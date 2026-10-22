// The Sessions tab without the junk (owner 2026-10-22: "chưa xoá session cũ rác dư thừa quá nhiều").
// Pure; tested in tests/sessions-list.test.ts.

/** A journal row of a session that is gone this long is deleted (HQ keeps its messages). */
export const JOURNAL_KEEP_MS = 3 * 24 * 3600 * 1000;

/**
 * Delete this journal row? Only when what is alive is known (`claude agents` answered: a failed call
 * must not wipe the journal), the session is not alive, and nothing touched the row for JOURNAL_KEEP_MS.
 */
export function staleJournal(row: { updated_at: number | null; started_at: number | null }, alive: boolean, known: boolean, now: number): boolean {
  if (!known || alive) return false;
  const at = Math.max(row.updated_at ?? 0, row.started_at ?? 0);
  return now - at > JOURNAL_KEEP_MS;
}

/** Live sessions first (as listed); ended ones apart, folded by default. */
export function splitSessions<T extends { status: string }>(sessions: T[]): { live: T[]; ended: T[] } {
  return { live: sessions.filter((s) => s.status !== "ended"), ended: sessions.filter((s) => s.status === "ended") };
}
