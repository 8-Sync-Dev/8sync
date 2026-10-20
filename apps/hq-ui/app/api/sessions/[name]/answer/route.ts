import { answerRoom, keysFit, type Expect } from "@/lib/server/answer";
import { readAsk } from "@/lib/server/ask";
import { bad, json, open, readBody } from "@/lib/server/http";
import { mergedSessions } from "@/lib/server/proc";
import { TERM_ID } from "@/lib/server/term";

export const runtime = "nodejs";

/**
 * `{kind: "permission" | "question", keys}`: one tap on a background room's dialog. `keys: []` only
 * reads what the dialog shows (the exact command or question); otherwise the allowlisted keys go in
 * through the room's terminal bridge, and only while the screen still shows that dialog (409 when it
 * moved on). The question and its options come from the room's own transcript, never the request.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/answer">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("cần session id của phòng", 422);
  const body = await readBody(req);
  const keys = body?.keys;
  const kind = body?.kind;
  if (!Array.isArray(keys) || keys.length > 2 || !keys.every((k) => typeof k === "string") || (kind !== "permission" && kind !== "question"))
    return bad("cần {kind: permission | question, keys}", 422);
  const s = (await mergedSessions(o.db)).find((x) => x.session_id === name && !x.tmux && x.status !== "ended");
  if (!s) return bad("phòng này không chạy nền (hoặc đã dừng)", 404);
  let expect: Expect = { kind: "permission" };
  if (kind === "question") {
    const ask = readAsk(name, s.cwd);
    const q = ask?.kind === "question" && ask.questions.length === 1 && !ask.questions[0].multi ? ask.questions[0] : null;
    if (!q || !q.options.length) return bad("câu hỏi này cần trả lời trong terminal", 409);
    expect = { kind: "question", question: q.question, options: q.options.map((x) => x.label) };
  }
  if (keys.length && !keysFit(keys as string[], expect)) return bad("phím không được phép", 422);
  const r = await answerRoom(name, s.cwd, expect, keys as string[]);
  return r.ok ? json({ ok: true, dialog: r.dialog }) : bad(r.error, r.status);
}
