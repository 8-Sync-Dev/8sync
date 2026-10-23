import { termGate } from "@/lib/interactive";
import { answerRoom, keysFit, type Expect } from "@/lib/server/answer";
import { readAsk } from "@/lib/server/ask";
import { bad, json, open, readBody } from "@/lib/server/http";
import { mergedSessions } from "@/lib/server/proc";
import { TERM_ID } from "@/lib/server/term";

export const runtime = "nodejs";

/**
 * `{kind: "permission" | "question", keys, text}`: one tap on a background room's dialog. `keys: []`
 * only reads what the dialog shows (the exact command or question). Otherwise `text` is the dialog
 * text the owner was shown (from that read): the allowlisted key goes in through the room's terminal
 * bridge only while the screen shows that same text (409 when it moved on, even to a new dialog of
 * the same kind). The question and its options come from the room's own transcript, never the request.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[name]/answer">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { name } = await ctx.params;
  if (!TERM_ID.test(name)) return bad("cần session id của phòng", 422);
  const body = await readBody(req);
  const keys = body?.keys;
  const kind = body?.kind;
  const text = typeof body?.text === "string" && body.text.length <= 4000 ? body.text : null;
  if (!Array.isArray(keys) || keys.length > 1 || !keys.every((k) => typeof k === "string") || (kind !== "permission" && kind !== "question"))
    return bad("cần {kind: permission | question, keys, text}", 422);
  if (keys.length && !text) return bad("cần text: đúng nội dung hộp thoại anh đã xem", 422);
  const s = (await mergedSessions(o.db)).find((x) => x.session_id === name && !x.tmux && x.status !== "ended");
  if (!s) return bad("phòng này không chạy nền (hoặc đã dừng)", 404);
  const gate = termGate(s);
  if (!gate.ok) return bad(gate.error, gate.status);
  let expect: Expect = { kind: "permission" };
  if (kind === "question") {
    const ask = readAsk(name, s.cwd);
    const q = ask?.kind === "question" && ask.questions.length === 1 && !ask.questions[0].multi ? ask.questions[0] : null;
    if (!q || !q.options.length) return bad("câu hỏi này cần trả lời trong terminal", 409);
    expect = { kind: "question", question: q.question, options: q.options.map((x) => x.label) };
  }
  if (keys.length && !keysFit(keys as string[], expect)) return bad("phím không được phép", 422);
  const r = await answerRoom(name, s.cwd, expect, keys as string[], text);
  return r.ok ? json({ ok: true, dialog: r.dialog }) : bad(r.error, r.status);
}
