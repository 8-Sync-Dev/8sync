import { ContentError } from "@/lib/server/content";
import { addComment, deleteComment, editComment, listComments } from "@/lib/server/content-comments";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/** A row id from `?<name>=` or a body field: a positive integer, else null. */
const idOf = (raw: unknown): number | null => {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw : "";
  return /^\d{1,12}$/.test(s) && Number(s) > 0 ? Number(s) : null;
};

function fail(e: unknown): Response {
  if (e instanceof ContentError) return bad(e.message, e.status);
  console.error("[hq] content comments", e);
  return bad("lưu góp ý lỗi", 500);
}

/**
 * "Góp ý" on a content item (lib/server/content-comments.ts), owner only (no guest route in lib/access).
 * GET `?item=N`: `{ drafts, sent }`. POST `{ item, text }` saves a draft. PATCH `?id=` `{ text }`
 * rewrites a draft, DELETE `?id=` drops one; a sent comment answers 409. Sending: ./send.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const item = idOf(new URL(req.url).searchParams.get("item"));
  if (item === null) return bad("item: cần số mục", 400);
  return json(listComments(o.db, item));
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const item = idOf(body.item);
  if (item === null) return bad("item: cần số mục", 400);
  try {
    return json({ comment: addComment(o.db, item, body.text), ...listComments(o.db, item) }, 201);
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = idOf(new URL(req.url).searchParams.get("id"));
  if (id === null) return bad("id: cần số góp ý", 400);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  try {
    const comment = editComment(o.db, id, body.text);
    return json({ comment, ...listComments(o.db, comment.item_id) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const id = idOf(new URL(req.url).searchParams.get("id"));
  if (id === null) return bad("id: cần số góp ý", 400);
  try {
    const item = deleteComment(o.db, id);
    return json({ ok: true, ...listComments(o.db, item) });
  } catch (e) {
    return fail(e);
  }
}
