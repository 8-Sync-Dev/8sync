import { answerLine } from "@/lib/ask";
import { deliveryOf } from "@/lib/labels";
import { mainRoot, rootKey } from "@/lib/preview";
import { SessionWaiting } from "@/lib/server/channel";
import { deliverText } from "@/lib/server/deliver";
import { bad, json, open, readBody } from "@/lib/server/http";
import { liveProjects } from "@/lib/server/in-view";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { readSolo } from "@/lib/server/solo";
import { SOLO_ACTIONS, soloMessage, type SoloAction } from "@/lib/solo";

export const runtime = "nodejs";

/**
 * `{root, session, action, answer?}`: drive `/solo` in a project from the "Vòng lặp" tab or the pinned
 * question. `root` must be a project with a live room (HQ's own list, never a folder from the browser
 * alone) and `session` a live Claude Code room of that project; the text is built here (lib/solo.ts
 * soloMessage), never taken from the request: `/solo`, `dừng`, `solo: <answer>`, `solo: override <label>`.
 * An answer goes only while SOLO.md says the project waits on the owner.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const raw = typeof body?.root === "string" ? body.root : "";
  if (!raw || raw.length > 1024) return bad("root: cần đường dẫn dự án", 422);
  const want = rootKey(raw);
  const action = body?.action as SoloAction;
  if (!SOLO_ACTIONS.includes(action)) return bad("action: start | stop | answer | override", 422);
  const answer = action === "answer" || action === "override" ? answerLine(body?.answer) : "";
  if (answer == null) return bad("answer: một dòng, tối đa 500 ký tự", 422);
  if (typeof body?.session !== "string" || !body.session) return bad("session: cần phòng Claude Code nhận lệnh", 422);

  const merged = await mergedSessions(o.db);
  const root = liveProjects(merged, (cwd) => projectOf(cwd))
    .map((p) => mainRoot(p.root))
    .find((r) => rootKey(r) === want);
  if (!root) return bad("dự án này không có phòng nào đang chạy", 409);
  // Claude Code rooms only: omp has no /solo skill.
  const room = merged.find((s) => {
    const p = s.status !== "ended" && s.engine !== "omp" && (s.name === body.session || s.session_id === body.session) ? projectOf(s.cwd) : null;
    return p != null && rootKey(p.root) === want;
  });
  if (!room) return bad("phòng này không chạy trong dự án (hoặc không phải Claude Code)", 404);

  if (action === "answer") {
    const solo = readSolo(root);
    if (solo?.state !== "waiting") return bad("Solo không còn chờ anh chọn", 409);
  }
  try {
    return json(await deliverText(o.db, room.name, soloMessage(action, answer, deliveryOf(room))), 201);
  } catch (e) {
    if (e instanceof SessionWaiting) return json({ error: "session-waiting", dialog: e.dialog }, 409);
    throw e;
  }
}
