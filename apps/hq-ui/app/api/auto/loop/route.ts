import { autoStatus, lastAutoStatus, loopSet } from "@/lib/server/auto";
import { bad, json, open, readBody } from "@/lib/server/http";
import { knownRoot } from "@/lib/server/in-view";
import { hasControlChars } from "@/lib/server/validate";
import { shipLoops } from "@/lib/slash";

export const runtime = "nodejs";

const FOCUS_MAX = 300;

/** Every project's auto-ship loop (the "Auto-ship: vòng N" chip), from the status HQ already polls. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const st = lastAutoStatus() ?? (await autoStatus());
  return json({ loops: shipLoops(st.ship_loops) });
}

/**
 * {root, on, focus?}: `/hq-auto-ship` (on) or `/hq-stop` / the chip's stop button (off) for one project
 * HQ shows (`8sync ccc auto loop on|off` there; the CLI accepts it only from the owner, which HQ is).
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (typeof body?.root !== "string" || !body.root || body.root.length > 1024 || typeof body.on !== "boolean") return bad("cần {root, on: true|false, focus?}", 422);
  const focus = body.focus == null ? null : typeof body.focus === "string" ? body.focus.trim() : undefined;
  if (focus === undefined || (focus && (focus.length > FOCUS_MAX || hasControlChars(focus)))) return bad(`focus: một dòng, tối đa ${FOCUS_MAX} ký tự`, 422);
  const root = await knownRoot(o.db, body.root);
  if (!root) return bad("dự án này không có trong HQ (không có phòng chạy, team hay thư mục đã thêm)", 409);
  const r = await loopSet(root, body.on, focus || null);
  return json(r, r.ok ? 200 : 502);
}
