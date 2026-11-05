import { OWNER, senderRoom, UI_HEADER, UI_VALUE, type Sender } from "../sender";
import type { Access } from "./auth";

/**
 * Who sent this delivery request (lib/sender.ts). The owner only when all hold: the owner's login
 * (not a guest), HQ's page marker, and a browser's same-origin fetch (`Sec-Fetch-Site`, which a
 * page cannot set and Node's fetch does not send). Anything else, such as hq.mjs with the UI token,
 * is a room: `room` is the name it gives (display only, sanitised).
 */
export function senderOf(req: Request, access: Access, room?: unknown): Sender {
  const page = req.headers.get(UI_HEADER) === UI_VALUE && req.headers.get("sec-fetch-site") === "same-origin";
  return page && access.role === "owner" && !access.guest ? OWNER : { by: "room", room: senderRoom(room) };
}
