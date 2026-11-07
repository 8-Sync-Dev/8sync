import { liveRooms, senderRoomOf } from "@/lib/server/brief";
import { decideFact, proposeFact, readFacts, replaceFacts, writeFacts } from "@/lib/server/facts";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";

export const runtime = "nodejs";

/** The shared facts and the bots' proposals waiting for the owner (lib/server/facts.ts): `{facts, pending, broken}`. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(readFacts());
}

/**
 * The owner's page only (403 for a room's hq.mjs): `{facts: string[]}` replaces the list, `{approve: id}` /
 * `{reject: id}` answers a bot's proposal. 200 `{facts, pending, broken}`; 422 a bad line, a full list or no
 * such proposal.
 */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ sửa fact chung, từ trang HQ", 403);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const cur = readFacts();
  let next = cur;
  if ("facts" in body) {
    const r = replaceFacts(cur, body.facts);
    if (!r.ok) return bad(r.error, 422);
    next = { ...cur, facts: r.value };
  } else if ("approve" in body || "reject" in body) {
    const r = decideFact(cur, body.approve ?? body.reject, "approve" in body);
    if (!r.ok) return bad(r.error, 422);
    next = r.value;
  } else return bad("Cần {facts: string[]} hoặc {approve: id} / {reject: id}", 400);
  writeFacts(next);
  return json(readFacts());
}

/**
 * A proposal (`hq.mjs fact "…"`): `{text, from?, from_session?, from_cwd?}` waits in `pending` until the
 * owner approves it in HQ; never a fact by itself, from anyone. 201 `{pending, created}` (false: the same
 * line already waits); 422 a bad line, a secret-looking one, one already a fact, or too many waiting.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const sender = senderOf(req, o.access, body.from);
  let from = sender.by === "owner" ? "owner" : sender.by === "room" ? sender.room : null;
  if (sender.by === "room") {
    const rooms = await liveRooms(o.db).catch(() => []);
    from = senderRoomOf(rooms, { session: body.from_session, cwd: body.from_cwd }, "")?.label ?? from;
  }
  const cur = readFacts();
  // A broken file is the owner's to overwrite (PUT keeps a .bad copy), not a bot's proposal.
  if (cur.broken) return bad("facts.json hỏng: chờ owner lưu lại danh sách trong HQ", 409);
  const r = proposeFact(cur, body.text, from);
  if (!r.ok) return bad(r.error, 422);
  if (r.value.created) writeFacts(r.value.facts);
  return json({ pending: r.value.pending, created: r.value.created }, 201);
}
