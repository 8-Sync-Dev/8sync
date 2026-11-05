import { bad, json, open, readBody } from "@/lib/server/http";
import { deliverWatched, SessionWaiting } from "@/lib/server/channel";
import { capturePlain, sendKeys } from "@/lib/server/proc";
import { inboxLive, queueInbox } from "@/lib/server/inbox";
import { ompModels, readRoomModel } from "@/lib/server/models";
import { isTmuxName } from "@/lib/server/validate";
import { isOmpRoomId } from "@/lib/labels";
import { CLAUDE_EFFORTS, CLAUDE_MODELS, claudeCommands, isThinking, OMP_THINKING, ompControl, SELECTOR_RE, type ModelsReply } from "@/lib/room-model";

export const runtime = "nodejs";

/**
 * The model + effort choices for one room (`?session=`) and what it runs now. omp rooms: `omp models`
 * (providers with a key or login); `apply` null while the room runs an 8sync-inbox from before the
 * switch (it writes no model state, and would type the control message as text). Claude Code rooms
 * HQ types into: the `/model` aliases. A Claude session started elsewhere (inbox only): `apply` null.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const session = new URL(req.url).searchParams.get("session");
  if (isOmpRoomId(session)) {
    const current = readRoomModel(session);
    const reply: ModelsReply = { engine: "omp", models: await ompModels(), efforts: [...OMP_THINKING], current, apply: current ? "inbox" : null };
    return json(reply);
  }
  const reply: ModelsReply = { engine: "claude", models: CLAUDE_MODELS, efforts: [...CLAUDE_EFFORTS], current: null, apply: isTmuxName(session) ? "terminal" : null };
  return json(reply);
}

/** `{session, model?, thinking?}`: switch the room from its next turn on (this session only). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const model = body.model == null || body.model === "" ? null : body.model;
  const thinking = body.thinking == null || body.thinking === "" ? null : body.thinking;
  if (model === null && thinking === null) return bad("model or thinking required", 422);
  const session = body.session;

  if (isOmpRoomId(session)) {
    if (model !== null && (typeof model !== "string" || !SELECTOR_RE.test(model))) return bad("model must be <provider>/<model>", 422);
    if (!readRoomModel(session)) return bad("phòng omp này mở trước bản 8sync-inbox biết đổi model: thoát rồi mở lại phòng", 409);
    if (thinking !== null && !isThinking(thinking)) return bad(`thinking must be one of ${OMP_THINKING.join(", ")}`, 422);
    if (model !== null) {
      const list = await ompModels();
      if (list.length > 0 && !list.some((m) => m.selector === model)) return bad("omp không có model này (hoặc chưa đăng nhập provider)", 422);
    }
    queueInbox(session, ompControl({ model: model as string | null, thinking: thinking as string | null }));
    return json({ apply: "inbox", live: inboxLive(session) }, 202);
  }

  if (!isTmuxName(session)) return bad("chỉ đổi được phòng omp hoặc phòng Claude Code HQ gõ vào terminal", 422);
  if (model !== null && !CLAUDE_MODELS.some((m) => m.selector === model)) return bad("model must be a /model alias", 422);
  if (thinking !== null && !(CLAUDE_EFFORTS as readonly unknown[]).includes(thinking)) return bad(`effort must be one of ${CLAUDE_EFFORTS.join(", ")}`, 422);
  try {
    for (const cmd of claudeCommands({ model: model as string | null, thinking: thinking as string | null })) {
      const r = await deliverWatched(o.db, session, cmd, { sendKeys, capture: capturePlain });
      if (r.delivery === "failed") return bad(r.error ?? "chưa gõ được vào terminal", 502);
    }
  } catch (e) {
    if (e instanceof SessionWaiting) return json({ error: "session-waiting", dialog: e.dialog }, 409);
    throw e;
  }
  return json({ apply: "terminal", live: true }, 202);
}
