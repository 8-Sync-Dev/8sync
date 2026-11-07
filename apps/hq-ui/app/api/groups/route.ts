import { liveRooms } from "@/lib/server/brief";
import { groupGuard, isGroupId, normGroup, readGroups, removeGroupLog, upsertGroup, writeGroups, type Group, type GroupsView, type HeldTurn } from "@/lib/server/groups";
import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";

export const runtime = "nodejs";

function view(groups: Group[]): GroupsView {
  const g = groupGuard();
  const held: Record<string, HeldTurn> = {};
  for (const x of groups) {
    const h = g.held(x.id);
    if (h) held[x.id] = h;
  }
  return { groups, held };
}

/** The bot groups (~/.config/8sync/hq/groups.json) and, per group, the turn the loop guard holds. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(view(readGroups()));
}

/**
 * `{group: {id?, name, emoji?, members, mode?, maxHops?, maxBotMsgsPerTurn?, maxParallel?}}`: adds a group
 * (no id) or changes one. Only from the owner's page: a room's hq.mjs never edits who talks to whom.
 * 422 bad field / a new member that is not a live room / too many groups; 404 unknown id.
 */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ sửa nhóm, từ trang HQ", 403);
  const body = await readBody(req);
  if (!body || !body.group || typeof body.group !== "object") return bad("Cần JSON {group: {...}}", 400);
  const id = (body.group as Record<string, unknown>).id;
  const groups = readGroups();
  const base = id === undefined ? null : (groups.find((g) => g.id === id) ?? null);
  if (id !== undefined && !base) return bad("Không có nhóm này", 404);
  const rooms = await liveRooms(o.db).catch(() => []);
  const n = normGroup(body.group, base, (m) => rooms.find((r) => r.status !== "ended" && (r.name === m || r.session_id === m))?.name ?? null);
  if (!n.ok) return bad(n.error, 422);
  const next = upsertGroup(groups, n.value);
  if (!next.ok) return bad(next.error, 422);
  writeGroups(next.value);
  return json({ ...view(next.value), group: n.value });
}

/** `?id=`: removes the group, its thread log and its turns. Owner's page only. */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ xoá nhóm, từ trang HQ", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!isGroupId(id)) return bad("id: g_…", 422);
  const groups = readGroups();
  if (!groups.some((g) => g.id === id)) return bad("Không có nhóm này", 404);
  const next = groups.filter((g) => g.id !== id);
  writeGroups(next);
  removeGroupLog(id);
  groupGuard().dropGroup(id);
  return json(view(next));
}
