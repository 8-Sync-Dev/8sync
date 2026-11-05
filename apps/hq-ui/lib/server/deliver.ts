// Hand one owner message to a room: the delivery behind POST /api/messages, shared with the
// "Nội dung" approve+send (lib/server/content.ts `approveAndSend`).
import type { DatabaseSync } from "node:sqlite";
import { deliverWatched } from "./channel";
import { inboxTarget } from "./floor";
import { inboxLive, isInboxId, queueInbox } from "./inbox";
import { capturePlain, sendKeys } from "./proc";
import { ownerMessage } from "./queries";

/**
 * A room HQ cannot type into (an omp room or a Claude session started elsewhere: `isInboxId`) gets
 * the message in its inbox, `to` naming the room for the header the session sees above it (`live`:
 * the room is polling, enters as soon as it is idle; otherwise at its next turn end). An hq-* tmux
 * room gets it typed in (`deliverWatched`), which throws `SessionWaiting` while the pane shows a dialog.
 */
export async function deliverText(db: DatabaseSync, session: string, text: string) {
  if (isInboxId(session)) {
    queueInbox(session, text, await inboxTarget(db, session));
    return { message: ownerMessage(db, session, text, "inbox"), delivery: "inbox" as const, live: inboxLive(session), error: null };
  }
  const r = await deliverWatched(db, session, text, { sendKeys, capture: capturePlain });
  return { message: r.message, delivery: r.delivery, error: r.error };
}
