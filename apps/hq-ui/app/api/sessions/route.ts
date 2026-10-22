import { type ProjectRow } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { isModelId, isRoleId, roleOf } from "@/lib/roles";
import { startHqSession } from "@/lib/server/start";
import { beats, channelStates, isFresh, notePane } from "@/lib/server/channel";
import { detectPane } from "@/lib/server/pane";
import { loadFloor, ompSessions } from "@/lib/server/floor";
import { capturePlain, channelArgs, listClaudeAgents, listTmux, mergedSessions } from "@/lib/server/proc";
import { toTmuxName, validateProjectPath } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const b = beats(o.db);
  const now = Date.now();
  const [merged, floor] = await Promise.all([mergedSessions(o.db), loadFloor(o.db)]);
  // One capture per live hq-* pane: org banner -> blocked-by-org, open dialog -> waiting.
  const panes = await Promise.all(merged.map((s) => (s.tmux ? capturePlain(s.name) : Promise.resolve(null))));
  merged.forEach((s, i) => notePane(o.db, s.name, panes[i]));
  const states = channelStates(o.db);
  const sessions = merged.map((s, i) => {
    const at = b.get(s.name) ?? null;
    const channel_state = states.get(s.name) ?? null;
    const waiting = panes[i] ? detectPane(panes[i]).waiting : null;
    return { ...s, channel: isFresh(at, now) && !channel_state, channel_beat_at: at, channel_state, waiting };
  });
  // The omp team's live rooms: inbox delivery only, no channel, no pane.
  const omp = ompSessions(o.db, floor).map((s) => ({ ...s, channel: false, channel_beat_at: null, channel_state: null, waiting: null }));
  return json({ sessions: [...sessions, ...omp], channel_mode: channelMode() });
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const name = toTmuxName(body.name);
  if (!name.ok) return bad(name.error, 422);
  const projectId = Number(body.project);
  const project = Number.isInteger(projectId)
    ? (o.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined)
    : undefined;
  if (!project) return bad("unknown project", 404);
  // Re-validate: the folder may have moved since it was registered.
  const dir = validateProjectPath(project.path);
  if (!dir.ok) return bad(`project folder: ${dir.error}`, 409);
  if (body.role != null && body.role !== "" && !isRoleId(body.role)) return bad("role: unknown role", 422);
  if (body.model != null && body.model !== "" && !isModelId(body.model)) return bad("model: not an allowed model", 422);
  const role = isRoleId(body.role) ? body.role : null;
  const model = isModelId(body.model) ? body.model : (roleOf(role)?.model ?? null);
  if ((await listTmux()).some((t) => t.name === name.value)) return bad(`${name.value} is already running`, 409);
  let r;
  try {
    r = await startHqSession(o.db, { name: name.value, projectId: project.id, cwd: dir.value, role, model, port: uiPort(req) });
  } catch (e) {
    return bad((e as Error).message, 500);
  }
  if (!r.ok) return bad(`không mở được session: ${r.stderr.trim() || "failed to start"}`, 502);
  const { channel, startedAt: now } = r;
  return json(
    {
      session: { name: name.value, project_id: project.id, started_at: now, status: "running", role, model },
      channel: { mode: channel.mode, reason: channel.reason },
    },
    201,
  );
}

function channelMode(): { mode: "channel" | "off"; reason: string | null } {
  try {
    const c = channelArgs();
    return { mode: c.mode, reason: c.reason };
  } catch (e) {
    return { mode: "off", reason: (e as Error).message };
  }
}

/** The port this UI listens on, so the channel inside the session can find it. */
function uiPort(req: Request): string | undefined {
  const fromEnv = process.env.PORT || process.env.HQ_UI_PORT;
  if (fromEnv && /^\d{1,5}$/.test(fromEnv)) return fromEnv;
  const m = /:(\d{1,5})$/.exec(req.headers.get("host") ?? "");
  return m?.[1];
}

/**
 * "Xoá session rác" (owner 2026-10-22: "tab session nên có nút xoá session rác"): delete the journal
 * rows of every session that is gone (not in tmux, not in `claude agents`). Nothing running is touched;
 * HQ keeps their messages. Refused while `claude agents` cannot answer: every row would look gone then.
 */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if ((await listClaudeAgents()) == null) return bad("claude agents không trả lời: không biết session nào còn chạy, chưa xoá gì", 503);
  const gone = (await mergedSessions(o.db)).filter((s) => s.status === "ended" && s.source === "journal").map((s) => s.name);
  const drop = o.db.prepare("DELETE FROM sessions WHERE name = ?");
  for (const name of gone) drop.run(name);
  return json({ deleted: gone.length });
}
