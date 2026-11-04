import { isFormat, isStatus } from "@/lib/content";
import { approveAndSend, ContentError, contentDbPath, createContent, deleteContent, hqApprover, listContent, openContent, updateContent } from "@/lib/server/content";
import { deliverText } from "@/lib/server/deliver";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/** `?id=` as a row id, or null. */
function idParam(req: Request): number | null {
  const raw = new URL(req.url).searchParams.get("id") ?? "";
  return /^\d{1,12}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

function fail(e: unknown): Response {
  if (e instanceof ContentError) return bad(e.message, e.status);
  console.error("[hq] content", e);
  return bad("ghi DB nội dung lỗi", 500);
}

/** The registry for writes: 404 when no DB is configured, 409 with the reason when it cannot be used. */
function registry() {
  const c = openContent();
  if ("configured" in c) return { res: bad("chưa cấu hình DB nội dung (EIGHTSYNC_CONTENT_DB hoặc ~/.config/8sync/hq/content.json)", 404) };
  if ("error" in c) return { res: bad(c.error, 409) };
  return c;
}

/**
 * "Nội dung" (content-post-agency `content_items`). `?probe=1`: only whether a DB is configured (HQ
 * hides the view when not). Filters: `status`, `format`, `fb_page`.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  if (q.get("probe") === "1") return json({ configured: contentDbPath() !== null });
  const status = q.get("status");
  const format = q.get("format");
  const page = q.get("fb_page");
  if (status && !isStatus(status)) return bad("status: không hợp lệ", 400);
  if (format && !isFormat(format)) return bad("format: không hợp lệ", 400);
  if (page && page.length > 200) return bad("fb_page: quá dài", 400);
  const c = openContent();
  if ("configured" in c) return json({ configured: false });
  if ("error" in c) return json({ configured: true, ready: false, error: c.error });
  try {
    return json(listContent(c.db, { status, format, fb_page: page }));
  } catch (e) {
    // A DB replaced or damaged since it opened: shown in the view, not a bare 500 on every poll.
    return json({ configured: true, ready: false, error: `không đọc được sổ nội dung: ${(e as Error).message}` });
  }
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const c = registry();
  if ("res" in c) return c.res;
  try {
    return json({ item: createContent(c.db, body) }, 201);
  } catch (e) {
    return fail(e);
  }
}

/**
 * `?id=`: body = fields to change, `status`, `scheduled_at` (ms | null), `assignee_session` (+
 * `assignee_base`; null clears), `approve_source: "<source URL the owner saw>"`, and `ai_label`
 * (true = AI used, label on when posting; false = no AI), required when approving an item with an
 * AI mark (else 409). An approved item edited into AI-risk content without it drops back to
 * `checked`; a published one answers 409.
 * Migration 0064 (else 400): `channels`, `captions_json` (merged; "" drops a channel's own caption)
 * and `retry_channel` (deletes a failed / blocked / cancelled channel row; 409 otherwise). Entering
 * `approved` answers 409 with what a channel misses.
 * "Duyệt" in one tap: `{ status: "approved", send: { session, base }, ai_label? }` approves AND
 * sends the posting task to that session (`approveAndSend`): a refusal sends nothing, a failed
 * delivery (502) leaves the status unchanged. Answers `{ item, sent }`.
 */
export async function PATCH(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = idParam(req);
  if (id === null) return bad("id: cần số mục", 400);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const c = registry();
  if ("res" in c) return c.res;
  try {
    if (!("send" in body)) return json({ item: updateContent(c.db, id, body, hqApprover()) });
    const send = body.send;
    if (body.status !== "approved" || Object.keys(body).some((k) => !["send", "status", "ai_label"].includes(k)) || !send || typeof send !== "object" || Array.isArray(send))
      return bad('send: chỉ đi cùng status "approved" (và ai_label), dạng { session, base }', 422);
    const { session, base } = send as Record<string, unknown>;
    const args = { session, base, ...("ai_label" in body ? { ai_label: body.ai_label } : {}) };
    return json(await approveAndSend(c.db, id, args, hqApprover(), (s, text) => deliverText(o.db, s, text)));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = idParam(req);
  if (id === null) return bad("id: cần số mục", 400);
  const c = registry();
  if ("res" in c) return c.res;
  try {
    return deleteContent(c.db, id) ? json({ ok: true }) : bad(`không có mục #${id}`, 404);
  } catch (e) {
    return fail(e);
  }
}
