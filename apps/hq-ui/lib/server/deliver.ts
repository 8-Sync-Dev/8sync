// Hand one message to a room: the delivery behind POST /api/messages, shared with the
// "Nội dung" approve+send (lib/server/content.ts `approveAndSend`) and the /solo controls.
import type { DatabaseSync } from "node:sqlite";
import { withSenderHeader, type Sender } from "../sender";
import { withOwnerDigest } from "./digest";
import { deliverWatched, SessionWaiting } from "./channel";
import { inboxTarget } from "./floor";
import { inboxLive, isInboxId, queueInbox } from "./inbox";
import { capturePlain, sendKeys } from "./proc";
import { ownerMessage } from "./queries";

/**
 * A room HQ cannot type into (an omp room or a Claude session started elsewhere: `isInboxId`) gets
 * the message in its inbox, `to` naming the room and `sender` the source for the header the session
 * sees above it (`live`: the room is polling, enters as soon as it is idle; otherwise at its next
 * turn end). An hq-* tmux room gets it typed in (`deliverWatched`), which throws `SessionWaiting`
 * while the pane shows a dialog; anyone but the owner's text goes in under its source line
 * (`[phòng web]`), so it never reads as a prompt the owner typed. The timeline row holds
 * the text as the room got it.
 */
export async function deliverText(db: DatabaseSync, session: string, text: string, sender: Sender) {
  const shown = withSenderHeader(text, sender);
  if (isInboxId(session)) {
    queueInbox(session, text, sender, await inboxTarget(db, session));
    return { message: ownerMessage(db, session, shown, "inbox"), delivery: "inbox" as const, live: inboxLive(session), error: null };
  }
  const r = await deliverWatched(db, session, shown, { sendKeys, capture: capturePlain });
  return { message: r.message, delivery: r.delivery, error: r.error };
}

/**
 * `deliverText`, a dialog open in the pane reported (`waiting`, the routes answer 409 session-waiting) instead
 * of thrown. The owner's message (a direct one, an "@B" forward, a group turn) carries HQ's "ai đang làm gì"
 * digest under it when that bot's picture changed (lib/server/digest.ts withOwnerDigest), remembered only
 * once it reached the bot.
 */
export async function deliverOrWaiting(db: DatabaseSync, session: string, text: string, sender: Sender) {
  const d = sender.by === "owner" ? await withOwnerDigest(db, session, text) : { text, commit: () => {} };
  try {
    const r = await deliverText(db, session, d.text, sender);
    if (r.delivery !== "failed") d.commit();
    return { ...r, waiting: false as const };
  } catch (e) {
    if (e instanceof SessionWaiting) return { delivery: "waiting", error: "session-waiting", dialog: e.dialog, waiting: true as const };
    throw e;
  }
}
