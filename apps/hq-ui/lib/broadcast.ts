// Pure rules behind the "Gửi cho mọi phòng" composer (no React). Tested in tests/broadcast.test.ts.
//
// Owner (2026-10-17): `8sync ccc auto add "<việc>" --now` works, but in HQ it was unclear where to
// type to reach every room: Chat tổng only showed the thread. The composer sits under Văn phòng and
// Chat tổng, and its summary line says which rooms the task reaches before it is sent.
import { groupByProject, type ProjectInfo } from "./office";

export const ALL_PROJECTS = "all";

type R = { key: string; label: string; cwd: string | null; project: ProjectInfo | null };
export type BroadcastProject = { root: string; name: string; rooms: string[] };
export type BroadcastResult = {
  name: string;
  ok: boolean;
  id: number | null;
  sent: { name: string; now: boolean }[];
  error: string | null;
};

/** Live rooms grouped by project like the office (git root, else cwd), most rooms first. */
export function broadcastProjects(rooms: R[]): BroadcastProject[] {
  return groupByProject(rooms.filter((r) => r.project || r.cwd))
    .map((g) => ({
      root: g.project.root,
      name: g.project.branch ? `${g.project.name} ⎇ ${g.project.branch}` : g.project.name,
      rooms: g.rooms.map((r) => r.label),
    }))
    .sort((a, b) => b.rooms.length - a.rooms.length || a.name.localeCompare(b.name));
}

const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * "Mọi dự án" runs `auto add` once per outermost root (server: lib/server/targets.ts outermost):
 * a worktree inside another root shares that root's queue, and `--now` reaches only the rooms
 * registered at the root it ran in, so worktree rooms take the task from the queue on a loop tick.
 */
export function outerProjects(projects: BroadcastProject[]): BroadcastProject[] {
  const roots = projects.map((p) => norm(p.root));
  return projects.filter((_, i) => !roots.some((o, j) => j !== i && roots[i].startsWith(`${o}/`)));
}

/** The project in scope when it has rooms, else the one with the most rooms; "" when none. */
export function defaultChoice(projects: BroadcastProject[], preferRoot?: string | null): string {
  const want = preferRoot?.toLowerCase();
  return projects.find((p) => want != null && p.root.toLowerCase() === want)?.root ?? projects[0]?.root ?? "";
}

/** Whether the owner's pick still exists ("all" needs two projects or more). */
export function choiceValid(picked: string | null, projects: BroadcastProject[]): boolean {
  if (picked == null) return false;
  return picked === ALL_PROJECTS ? projects.length > 1 : projects.some((p) => p.root === picked);
}

/** The owner's pick while it still exists, else the default (a project that lost every room falls back). */
export function resolveChoice(picked: string | null, projects: BroadcastProject[], preferRoot?: string | null): string {
  return choiceValid(picked, projects) ? picked! : defaultChoice(projects, preferRoot);
}

/** The projects a choice covers ("all" = every outermost root). */
export function pickedProjects(choice: string, projects: BroadcastProject[]): BroadcastProject[] {
  return choice === ALL_PROJECTS ? outerProjects(projects) : projects.filter((p) => p.root === choice);
}

function names(rooms: string[], n = 4): string {
  return rooms.length <= n ? rooms.join(", ") : `${rooms.slice(0, n).join(", ")} +${rooms.length - n}`;
}

/**
 * One line under the box: where the task goes and when the rooms take it. "tối đa": only rooms
 * opened with `8sync ccc .` get the push; the result lines say which ones did.
 */
export function broadcastSummary(choice: string, projects: BroadcastProject[], now: boolean): string {
  const picked = pickedProjects(choice, projects);
  const rooms = picked.flatMap((p) => p.rooms);
  if (rooms.length === 0) return "Chưa có phòng nào đang chạy. Mở phòng bằng `8sync ccc . <tên>` trong thư mục dự án.";
  const where = choice === ALL_PROJECTS ? `ở ${picked.length} dự án` : `trong ${picked[0].name}`;
  const nested = choice === ALL_PROJECTS && picked.length < projects.length ? " Phòng trong worktree nhận qua hàng chung ở nhịp loop." : "";
  return now
    ? `Gửi ngay cho tối đa ${rooms.length} phòng ${where}: ${names(rooms)}. Phòng mở bằng \`8sync ccc .\` nhận ngay, phòng đang bận nhận khi xong lượt.${nested}`
    : `Vào hàng đích ${where} (${rooms.length} phòng): các phòng làm khi tới lượt, lúc auto đang chạy.${nested}`;
}

/** What happened in one project, from `8sync ccc auto add --json`. */
export function resultLine(r: BroadcastResult, now: boolean): string {
  if (!r.ok) return `${r.name}: chưa gửi được (${r.error ?? "lỗi không rõ"})`;
  const head = `${r.name}: đích #${r.id ?? "?"}`;
  if (!now) return `${head} đã vào hàng`;
  if (r.sent.length === 0) return `${head} đã vào hàng, nhưng dự án chưa có phòng mở bằng \`8sync ccc . <tên>\` để nhận ngay`;
  const live = r.sent.filter((s) => s.now).map((s) => s.name);
  const later = r.sent.filter((s) => !s.now).map((s) => s.name);
  const parts = [
    ...(live.length ? [`nhận ngay khi rảnh: ${live.join(", ")}`] : []),
    ...(later.length ? [`nhận khi xong lượt: ${later.join(", ")}`] : []),
  ];
  return `${head} đã gửi ${r.sent.length} phòng (${parts.join("; ")})`;
}

/** After a send: clear the box only when every project took it, and name the ones that did not. */
export function sendOutcome(results: BroadcastResult[]): { clear: boolean; failed: string[]; sent: number } {
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  return { clear: results.length > 0 && failed.length === 0, failed, sent: results.reduce((n, r) => n + r.sent.length, 0) };
}

/** Send only on Ctrl/Cmd+Enter: one stray Enter must not push a half-typed task into every room. */
export function isSendKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; isComposing: boolean }): boolean {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing;
}
