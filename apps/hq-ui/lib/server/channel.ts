import type { DatabaseSync } from "node:sqlite";
import { stamp } from "./db";
import { ingest } from "./ingest";
import { detectPane } from "./pane";
import { ownerMessage, type MessageRow } from "./queries";

/** Contract §2: the channel beats every 15 s; it counts as connected under ~45 s. */
export const CHANNEL_FRESH_MS = 45_000;

export function recordBeat(db: DatabaseSync, session: string, at = Date.now()): void {
  db.prepare(
    "INSERT INTO channel_beats(session, at) VALUES (?, ?) ON CONFLICT(session) DO UPDATE SET at = excluded.at",
  ).run(session, at);
}

export function beats(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare("SELECT session, at FROM channel_beats").all() as { session: string; at: number }[];
  return new Map(rows.map((r) => [r.session, Number(r.at)]));
}

export function isFresh(beatAt: number | null | undefined, now = Date.now()): boolean {
  return beatAt != null && now - beatAt >= 0 && now - beatAt < CHANNEL_FRESH_MS;
}

export function channelConnected(db: DatabaseSync, session: string, now = Date.now()): boolean {
  const r = db.prepare("SELECT at FROM channel_beats WHERE session = ?").get(session) as { at: number } | undefined;
  return isFresh(r ? Number(r.at) : null, now);
}

/**
 * - blocked-by-org: the pane shows Claude Code's "Channels are not enabled"
 *   banner. The channel server still heartbeats, but Claude drops its events.
 * - unresponsive: legacy value, no longer set (a single timeout is not proof);
 *   still read so old rows clear when the channel's reply tool is used.
 * blocked-by-org sends owner messages to the terminal until the session restarts.
 */
export type ChannelState = "blocked-by-org" | "unresponsive";

export function getChannelState(db: DatabaseSync, session: string): ChannelState | null {
  const r = db.prepare("SELECT state FROM channel_state WHERE session = ?").get(session) as { state: string } | undefined;
  return r?.state === "blocked-by-org" || r?.state === "unresponsive" ? r.state : null;
}

export function setChannelState(db: DatabaseSync, session: string, state: ChannelState | null): void {
  if (state === null) {
    db.prepare("DELETE FROM channel_state WHERE session = ?").run(session);
    return;
  }
  // blocked-by-org is the stronger fact; an 'unresponsive' verdict never overwrites it.
  db.prepare(
    `INSERT INTO channel_state(session, state, at) VALUES (?, ?, ?)
     ON CONFLICT(session) DO UPDATE SET state = CASE WHEN channel_state.state = 'blocked-by-org' THEN channel_state.state ELSE excluded.state END,
       at = excluded.at`,
  ).run(session, state, Date.now());
}

export function channelStates(db: DatabaseSync): Map<string, ChannelState> {
  const rows = db.prepare("SELECT session, state FROM channel_state").all() as { session: string; state: ChannelState }[];
  return new Map(rows.map((r) => [r.session, r.state]));
}

/** Records blocked-by-org when the pane shows the org banner. Returns whether it is blocked. */
export function notePane(db: DatabaseSync, session: string, paneText: string | null): boolean {
  if (paneText && detectPane(paneText).blocked) {
    setChannelState(db, session, "blocked-by-org");
    return true;
  }
  return getChannelState(db, session) === "blocked-by-org";
}

/** The session shows a dialog or menu: typing now would answer it by accident. */
export class SessionWaiting extends Error {
  constructor(public dialog: string) {
    super(`session-waiting: ${dialog}`);
  }
}

/** Dialog label when the pane shows one, else null (also null when the pane cannot be read). */
export async function openDialog(session: string, capture?: CapturePane): Promise<string | null> {
  const pane = capture ? await capture(session).catch(() => null) : null;
  return pane ? detectPane(pane).waiting : null;
}

export type Delivery = "channel" | "terminal" | "channel→terminal" | "failed";
export type SendKeys = (session: string, text: string) => Promise<{ ok: boolean; stderr: string }>;
export type CapturePane = (session: string) => Promise<string | null>;

/**
 * Owner message delivery (contract §3). A fresh heartbeat means the channel
 * long-polls the inbox, so storing the row with delivery='channel' is the
 * delivery. Otherwise the text is typed into the session's tmux pane. The row
 * is stored either way so the timeline shows it, tagged with the path used.
 */
export async function deliverOwnerMessage(
  db: DatabaseSync,
  session: string,
  text: string,
  deps: { sendKeys: SendKeys; capture?: CapturePane; now?: number },
): Promise<{ message: MessageRow; delivery: Delivery; error: string | null }> {
  // Throws SessionWaiting before anything is stored or typed. A channel delivery
  // is refused too: the owner is meant to answer the dialog first.
  const pane = deps.capture ? await deps.capture(session).catch(() => null) : null;
  const dialog = pane ? detectPane(pane).waiting : null;
  if (dialog) throw new SessionWaiting(dialog);
  if (channelConnected(db, session, deps.now) && !getChannelState(db, session)) {
    // A heartbeat only proves the channel server runs, not that Claude accepts
    // its events: look at the pane for the org banner before trusting it.
    if (!notePane(db, session, pane)) {
      return { message: ownerMessage(db, session, text, "channel"), delivery: "channel", error: null };
    }
  }
  let error: string | null = null;
  try {
    const r = await deps.sendKeys(session, text);
    if (!r.ok) error = r.stderr.trim() || "tmux send-keys failed";
  } catch (e) {
    error = (e as Error).message;
  }
  const delivery: Delivery = error ? "failed" : "terminal";
  return { message: ownerMessage(db, session, text, delivery), delivery, error };
}

/** No reply, task or other journal row from the session this long after a channel delivery: retype it. */
export const CHANNEL_ACK_MS = 25_000;

/** Any row from the session after `afterId` other than the owner's own messages. */
export function sessionActiveSince(db: DatabaseSync, session: string, afterId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM messages WHERE session = ? AND id > ? AND kind != 'owner_message' LIMIT 1")
    .get(session, afterId);
}

export type RetryOutcome = "answered" | "skipped" | "retried" | "failed" | "held" | "unconfirmed";

/**
 * Runs once, CHANNEL_ACK_MS after a channel delivery. If the channel poller
 * never fetched the row, it is typed into the pane once and tagged
 * 'channel→terminal'. If the poller did fetch it, the text is never retyped
 * (Claude may have it and just be slow): the row is only tagged 'unconfirmed'.
 * No sticky channel state is set from one timeout.
 */
export async function retryIfUnanswered(db: DatabaseSync, messageId: number, deps: { sendKeys: SendKeys; capture?: CapturePane }): Promise<RetryOutcome> {
  try {
    ingest(db);
  } catch {
    /* judge on what is already ingested */
  }
  const m = db.prepare("SELECT id, session, text, delivery FROM messages WHERE id = ?").get(messageId) as
    | { id: number; session: string | null; text: string | null; delivery: string | null }
    | undefined;
  if (!m?.session || !m.text || m.delivery !== "channel") return "skipped";
  if (sessionActiveSince(db, m.session, m.id)) return "answered";
  if (await openDialog(m.session, deps.capture)) {
    // A dialog opened meanwhile: typing would answer it. Stop; the owner resends.
    db.prepare("UPDATE messages SET delivery = 'held' WHERE id = ?").run(m.id);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE name = ?").run(stamp(), m.session);
    return "held";
  }
  // Claim the row atomically: once delivery leaves 'channel' the inbox never serves it.
  const claimed = db
    .prepare("UPDATE messages SET delivery = 'channel→terminal' WHERE id = ? AND delivery = 'channel' AND picked_up_at IS NULL")
    .run(m.id);
  if (Number(claimed.changes) === 0) {
    db.prepare("UPDATE messages SET delivery = 'unconfirmed' WHERE id = ? AND delivery = 'channel'").run(m.id);
    db.prepare("UPDATE sessions SET updated_at = ? WHERE name = ?").run(stamp(), m.session);
    return "unconfirmed";
  }
  let ok = false;
  try {
    ok = (await deps.sendKeys(m.session, m.text)).ok;
  } catch {
    ok = false;
  }
  if (!ok) db.prepare("UPDATE messages SET delivery = 'failed' WHERE id = ?").run(m.id);
  // Bump the session so the UI's stream reloads its channel state.
  db.prepare("UPDATE sessions SET updated_at = ? WHERE name = ?").run(stamp(), m.session);
  return ok ? "retried" : "failed";
}

/** In-process timer; unref'd so it never holds the server open. */
export function scheduleChannelRetry(
  db: DatabaseSync,
  messageId: number,
  deps: { sendKeys: SendKeys; capture?: CapturePane; delayMs?: number; onDone?: (o: RetryOutcome) => void },
): ReturnType<typeof setTimeout> {
  const t = setTimeout(() => {
    void retryIfUnanswered(db, messageId, deps).then(deps.onDone, (e) => console.error("[hq] channel retry failed", e));
  }, deps.delayMs ?? CHANNEL_ACK_MS);
  (t as { unref?: () => void }).unref?.();
  return t;
}

/** deliverOwnerMessage + the one-shot terminal retry when the channel path was used. */
export async function deliverWatched(
  db: DatabaseSync,
  session: string,
  text: string,
  deps: { sendKeys: SendKeys; capture?: CapturePane; delayMs?: number },
): ReturnType<typeof deliverOwnerMessage> {
  const r = await deliverOwnerMessage(db, session, text, deps);
  if (r.delivery === "channel") scheduleChannelRetry(db, r.message.id, deps);
  return r;
}
