import { ContentError, getContent, openContent } from "@/lib/server/content";
import { sendComments } from "@/lib/server/content-comments";
import { deliverText } from "@/lib/server/deliver";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";

export const runtime = "nodejs";

/**
 * POST `{ item, session?, base? }`: every "Góp ý" draft of the item in ONE message to its posting room
 * (lib/server/content-comments.ts `sendComments`): `session` as picked in the sheet, else the item's
 * `assignee_session`. Owner only. 502 when the delivery fails (the drafts stay); answers
 * `{ delivered, count, drafts, sent }` (the lists as GET ../ answers them).
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const raw = typeof body.item === "number" ? String(body.item) : typeof body.item === "string" ? body.item : "";
  if (!/^\d{1,12}$/.test(raw) || Number(raw) <= 0) return bad("item: cần số mục", 400);
  const c = openContent();
  if ("configured" in c) return bad("chưa cấu hình DB nội dung (EIGHTSYNC_CONTENT_DB hoặc ~/.config/8sync/hq/content.json)", 404);
  if ("error" in c) return bad(c.error, 409);
  try {
    const it = getContent(c.db, Number(raw));
    if (!it) return bad(`không có mục #${raw}`, 404);
    const own = body.session != null;
    const sender = senderOf(req, o.access);
    const r = await sendComments(o.db, it, { session: own ? body.session : it.assignee_session, base: own ? body.base : it.assignee_base }, (s, text) => deliverText(o.db, s, text, sender));
    return json({ delivered: r.sent, count: r.count, ...r.comments });
  } catch (e) {
    if (e instanceof ContentError) return bad(e.message, e.status);
    console.error("[hq] content comments send", e);
    return bad("gửi góp ý lỗi", 500);
  }
}
