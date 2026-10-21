// Owner -> session messages for sessions HQ cannot type into (not in an hq-* tmux pane:
// any Claude Code session started in another terminal, every session on Windows).
// The kit's Stop hook (`8sync ccc hook verify-stop`, crates/cli/src/verbs/hq.rs take_inbox)
// hands them to Claude when the session ends its current turn: delivered once, masked.
import fs from "node:fs";
import path from "node:path";
import { isOmpRoomId } from "../labels";
import { stateDir } from "./paths";

/** A Claude session id (uuid) as a file name. */
export const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isSessionId(s: unknown): s is string {
  return typeof s === "string" && SESSION_ID_RE.test(s);
}

/** Any room's inbox id (`8sync ls` `inbox_id`, contract C3): a Claude session id or an omp room id. Nothing else is ever a file name. */
export function isInboxId(s: unknown): s is string {
  return isSessionId(s) || isOmpRoomId(s);
}

export const inboxDir = () => path.join(stateDir(), "inbox");

export function inboxFile(id: string): string {
  if (!isInboxId(id)) throw new Error("bad inbox id");
  return path.join(inboxDir(), `${id}.jsonl`);
}

/** Append one message (0600 file in a 0700 dir). */
export function queueInbox(sessionId: string, text: string, ts = Date.now()): void {
  const file = inboxFile(sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify({ ts, text })}\n`, { mode: 0o600 });
}

/**
 * The `8sync-inbox` mod touches `<id>.live` on every poll (crates/cli/src/verbs/hq.rs claim_inbox),
 * from session start and whenever the session is idle. A marker from the last day means the
 * session has the mod loaded, so a queued task enters as soon as it is idle; missing (or a day
 * old: ids are never reused) means the task waits for the Stop hook (next turn end) until the
 * owner runs `/reload-plugins` in that session. Age is not "polling now": a long turn does not
 * poll. Same window as the Rust side (LIVE_FOR).
 */
export const LIVE_MS = 24 * 3600_000;

export function inboxLive(sessionId: string, now = Date.now()): boolean {
  if (!isInboxId(sessionId)) return false;
  try {
    return now - fs.statSync(path.join(inboxDir(), `${sessionId}.live`)).mtimeMs < LIVE_MS;
  } catch {
    return false;
  }
}

/** Messages still waiting for the session's next turn end. */
export function pendingInbox(sessionId: string): number {
  try {
    return fs.readFileSync(inboxFile(sessionId), "utf8").split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}
