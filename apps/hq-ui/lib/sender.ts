// Who a message HQ hands to a room comes from. The room sees it as the header above the text
// (crates/cli/src/verbs/hq.rs `header` for an inbox, `senderHeader` below for a typed one), and
// only the owner header (`[owner]` / `[owner → …]`) lets a `/solo`, `/autopilot`… grant merge and
// release (crates/cli/src/verbs/ccc/grant.rs). Default-deny: the owner is a request from HQ's own
// page (UI_HEADER, which components/hq/use-hq.ts `makeApi` adds and hq-control's hq.mjs never
// sends) made with the owner's login; a room's `hq.mjs send`, a guest, HQ's own timers and
// anything else is not.

/** The marker HQ's page puts on every API call. Not a secret: the owner's login still decides. */
export const UI_HEADER = "x-hq-ui";
export const UI_VALUE = "owner-page";

export type Sender = { by: "owner" } | { by: "room"; room: string | null } | { by: "auto" };

export const OWNER: Sender = { by: "owner" };
/** HQ's own automatic messages (the content digest). */
export const AUTO: Sender = { by: "auto" };

const ROOM_FIELD = 48;

/**
 * The sending room's name as a header may show it (same rule as hq.rs `sender_field`): one line,
 * no bracket or header separator, capped; a name that says "owner" is dropped (`phòng khác`).
 */
export function senderRoom(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = [...s.replace(/[\p{Cc}\p{Cf}[\]·→]/gu, " ").split(/\s+/).filter(Boolean).join(" ")].slice(0, ROOM_FIELD).join("");
  return t && !/owner/i.test(t) ? t : null;
}

/** The line a typed (tmux / channel) delivery starts with; null for the owner, whose words go in as typed. */
export function senderHeader(s: Sender): string | null {
  if (s.by === "owner") return null;
  return s.by === "auto" ? "[tự động]" : `[phòng ${s.room ?? "khác"}]`;
}

/** `text` as a room receives it when HQ types it in, and as the timeline stores it. */
export function withSenderHeader(text: string, s: Sender): string {
  const h = senderHeader(s);
  return h ? `${h}\n${text}` : text;
}
