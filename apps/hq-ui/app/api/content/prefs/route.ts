import { parseAssignPref, saveAssignPref } from "@/lib/server/content-prefs";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * The "Nội dung" view's server-side preferences (GET /api/content carries them as `assign`).
 * Body `{ assign: { session, base } }` sets the session "Duyệt" sends to by default; `{ assign: null }` forgets it.
 */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body || !("assign" in body)) return bad("JSON body { assign } required");
  const assign = parseAssignPref(body.assign);
  if (assign === undefined) return bad("assign: { session: id phòng omp hoặc session Claude, base: nhãn } hoặc null", 422);
  try {
    saveAssignPref(assign);
  } catch (e) {
    return bad(`không lưu được phiên mặc định: ${(e as Error).message}`, 500);
  }
  return json({ assign });
}
