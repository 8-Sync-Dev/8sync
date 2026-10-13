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

/** Sessions the composer can message. Empty means: hide the composer, show the start CTA. */
export function messageTargets<T extends Pick<Session, "tmux" | "status">>(sessions: T[]): T[] {
  return sessions.filter((s) => s.tmux && s.status !== "ended");
}
