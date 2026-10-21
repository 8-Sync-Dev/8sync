// Sidebar room actions, through the verbs that already exist (never a second way):
// - close: `claude stop <id>` for a Claude Code background room (its conversation is kept, `8sync ccc
//   auto up` resumes it; what `auto down` runs per room), tmux kill for an hq-* room (/stop route).
// - delete: close, then `claude rm <id>` (drops the background session and its own worktree; Claude
//   Code keeps a worktree with unpushed commits and says so), then `8sync ccc . rm <name>` for the
//   registry entry bound to that session, which also deletes the room's transcript.
// The room comes from HQ's own session list; the request only names it. argv-only.
import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { isOmpRoomId } from "@/lib/labels";
import { repoOf } from "@/lib/sidebar";
import { stamp } from "./db";
import { projectOf } from "./office";
import { listClaudeAgents, mergedSessions, run, stopTmux, type SessionView } from "./proc";
import { tail } from "./team";

export type RoomAction = "close" | "delete";
export const isRoomAction = (v: unknown): v is RoomAction => v === "close" || v === "delete";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A registry room name (crates/ccc-core registry valid_name) that cannot read as a flag or a path. */
const ROOM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** `warning`: the room is deleted but something the owner should know was left (its registry entry). */
export type EndResult = {
  status: number;
  body: { ok: true; action: RoomAction; registry: string | null; warning: string | null } | { error: string };
};

const fail = (status: number, error: string): EndResult => ({ status, body: { error } });

/** `claude stop|rm <short id>` (team.rs passes the first 8 chars the same way). */
async function claude(verb: "stop" | "rm", id: string): Promise<{ ok: boolean; error: string }> {
  const r = await run("claude", [verb, id.slice(0, 8)], 30_000);
  return { ok: r.ok, error: r.killed ? `claude ${verb} không trả lời sau 30 giây` : tail(`${r.stderr}\n${r.stdout}`, 4) || `claude ${verb} thất bại` };
}

/** The registry entry a lookup found: its room name and the folder whose `ccc .` registry holds it. */
type RegistryEntry = { name: string; dir: string };

/**
 * The registry entry bound to this session, looked up before anything is deleted (`claude rm` may
 * remove the room's worktree, and `ccc .` cannot run from a folder that is gone). Tries the repo
 * root first, then the room's own folder: `ccc .` resolves its registry from the folder it runs in,
 * so the entry must later be removed from that same folder, never from another one (a different
 * registry may hold another room under the same name).
 */
async function findRegistry(sid: string, cwd: string | null): Promise<RegistryEntry | null> {
  if (!cwd) return null;
  for (const dir of new Set([repoOf(projectOf(cwd)?.root ?? cwd).root, cwd])) {
    const ls = await run("8sync", ["ccc", ".", "ls", "--json"], 10_000, dir);
    if (!ls.ok) continue;
    let rows: unknown;
    try {
      rows = JSON.parse(ls.stdout);
    } catch {
      continue;
    }
    const row = Array.isArray(rows)
      ? rows.find((x: unknown) => !!x && typeof x === "object" && (("id" in x && x.id === sid) || ("sid" in x && x.sid === sid)))
      : undefined;
    const name: unknown = row && typeof row === "object" && "name" in row ? row.name : null;
    if (typeof name === "string" && ROOM_NAME.test(name)) return { name, dir };
  }
  return null;
}

/**
 * HQ's own row for a closed room, status ended: it keeps the room's folder among the projects HQ
 * knows (the worktree delete needs it once the room stopped) and keeps it off the live list.
 */
function markEnded(db: DatabaseSync, s: SessionView): void {
  db.prepare(
    `INSERT INTO sessions(name, project_id, started_at, status, cwd, updated_at) VALUES (?, ?, ?, 'ended', ?, ?)
     ON CONFLICT(name) DO UPDATE SET status = 'ended', updated_at = excluded.updated_at`,
  ).run(s.name, s.project_id, s.started_at, s.cwd, stamp());
}

export async function endRoom(db: DatabaseSync, name: string, action: RoomAction): Promise<EndResult> {
  if (isOmpRoomId(name)) return fail(409, "Phòng omp: dừng cả đội bằng “Dừng team” của dự án.");
  const s = (await mergedSessions(db)).find((x) => x.name === name);
  if (!s || (action === "close" && s.status === "ended")) {
    // Without `claude agents` nothing is known alive: say so instead of "it stopped" (it may still run).
    if (!(await listClaudeAgents())) return fail(502, "Không gọi được `claude agents`: chưa biết phòng còn chạy không, thử lại sau.");
    return fail(404, "Phòng này không còn chạy.");
  }

  if (s.source === "tmux") {
    const r = await stopTmux(s.name);
    if (!r.ok) return fail(502, `tmux: ${r.stderr.trim() || "không dừng được phòng"}`);
    if (action === "close") markEnded(db, s);
    else db.prepare("DELETE FROM sessions WHERE name = ?").run(s.name);
    return done(action, null, null);
  }

  const sid = s.session_id;
  if (s.source !== "claude" || !sid || !SESSION_ID.test(sid)) return fail(409, "HQ không thấy tiến trình của phòng này: đóng nó ở nơi đã mở.");
  const agents = await listClaudeAgents();
  if (!agents) return fail(502, "Không gọi được `claude agents`: thử lại sau.");
  const agent = agents.find((a) => a.sessionId === sid);
  if (agent && agent.kind !== "background") return fail(409, "Phòng này là terminal anh tự mở: đóng nó ở terminal đó.");

  // Delete: the registry entry first, while the room's folder still exists (`claude rm` may delete it).
  const entry = action === "delete" ? await findRegistry(sid, s.cwd) : null;
  if (agent) {
    const stop = await claude("stop", sid);
    if (!stop.ok) return fail(502, stop.error);
  }
  if (action === "close") {
    markEnded(db, s);
    return done(action, null, null);
  }
  const rm = await claude("rm", sid);
  if (!rm.ok) return fail(409, `Đã dừng phòng nhưng chưa xóa được: ${rm.error}`);
  db.prepare("DELETE FROM sessions WHERE name = ?").run(s.name);
  if (!entry) return done(action, null, "Không thấy phòng trong sổ phòng (`8sync ccc . ls`): hội thoại của phòng chưa bị xóa.");
  if (!fs.existsSync(entry.dir)) return done(action, null, `Thư mục ${entry.dir} đã bị xóa cùng worktree: phòng “${entry.name}” còn trong sổ phòng và hội thoại chưa bị xóa.`);
  const drop = await run("8sync", ["ccc", ".", "rm", entry.name], 10_000, entry.dir);
  if (!drop.ok) return done(action, null, `8sync ccc . rm ${entry.name} thất bại: ${tail(drop.stderr, 3) || "không rõ lý do"}. Hội thoại của phòng chưa bị xóa.`);
  return done(action, entry.name, null);
}

function done(action: RoomAction, registry: string | null, warning: string | null): EndResult {
  return { status: 200, body: { ok: true, action, registry, warning } };
}
