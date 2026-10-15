// Pure rules behind the "Giao việc" dialog (no React). Tested in tests/assign-ui.test.ts.
//
// Owner (2026-10-15): the old dialog mixed roles and sessions in one dropdown, so it was unclear
// whether a task went to one session, to whoever has a role, or to every session of a repo.
// The dialog now has three explicit modes and one summary line that says exactly where it goes.
import type { Project, Session } from "@/components/hq/types";
import { deliveryOf, messageTargets, sessionLabel } from "./labels";
import { roleOf, modelShort } from "./roles";

export type AssignMode = "session" | "role" | "project";

type S = Pick<Session, "tmux" | "status" | "name" | "session_id" | "project_id" | "role" | "label">;
type P = Pick<Project, "id" | "name">;

export type SessionGroup<T> = { projectId: number | null; name: string; sessions: T[] };

export const OTHER_GROUP = "Phiên khác";

/** Reachable live sessions grouped by project, projects in the given order; sessions without a project last. */
export function groupTargets<T extends S>(sessions: T[], projects: P[]): SessionGroup<T>[] {
  const reach = messageTargets(sessions);
  const groups: SessionGroup<T>[] = [];
  for (const p of projects) {
    const inP = reach.filter((s) => s.project_id === p.id);
    if (inP.length) groups.push({ projectId: p.id, name: p.name, sessions: inP });
  }
  const known = new Set(projects.map((p) => p.id));
  const rest = reach.filter((s) => s.project_id == null || !known.has(s.project_id));
  if (rest.length) groups.push({ projectId: null, name: OTHER_GROUP, sessions: rest });
  return groups;
}

/** The live hq sessions a role assignment can reuse (server picks the least-recently-active one). */
export function roleTargets<T extends S>(role: string, sessions: T[]): T[] {
  return sessions.filter((s) => s.tmux && s.status !== "ended" && s.role === role);
}

/** Reachable sessions that carry the role but were started outside HQ: role routing cannot reach them, "Một phiên" can. */
export function outsideRole<T extends S>(role: string, sessions: T[]): T[] {
  return messageTargets(sessions).filter((s) => !s.tmux && s.role === role);
}

/** Every reachable session of a project (null = every project): the "Cả dự án" fan-out. */
export function projectTargets<T extends S>(projectId: number | null, sessions: T[]): T[] {
  return messageTargets(sessions).filter((s) => projectId == null || s.project_id === projectId);
}

/** "rd, web, zus-core" (max `n` names, then "+k"). */
export function nameList(sessions: S[], n = 4): string {
  const names = sessions.map(sessionLabel);
  return names.length <= n ? names.join(", ") : `${names.slice(0, n).join(", ")} +${names.length - n}`;
}

export type Summary = {
  mode: AssignMode;
  session?: S | null;
  role?: string | null;
  roleSessions?: S[];
  project?: P | null;
  projectSessions?: S[];
};

/** One line that says exactly where the task will go, or "" when nothing is chosen yet. */
export function assignSummary(x: Summary): string {
  if (x.mode === "session") {
    if (!x.session) return "";
    const via = deliveryOf(x.session) === "inbox" ? "qua inbox (nhận khi xong lượt)" : "vào terminal";
    return `Giao cho phiên ${sessionLabel(x.session)} ${via}`;
  }
  if (x.mode === "role") {
    const r = roleOf(x.role);
    if (!r) return "";
    const live = x.roleSessions ?? [];
    if (live.length === 0) return `Chưa có phiên ${r.labelVi}: mở phiên mới (${modelShort(r.model)}) trong ${x.project?.name ?? "dự án đã chọn"}`;
    if (live.length === 1) return `Giao cho phiên ${sessionLabel(live[0])} (${r.labelVi} duy nhất đang chạy)`;
    return `Giao cho phiên ${r.labelVi} rảnh lâu nhất trong ${live.length} phiên: ${nameList(live)}`;
  }
  const all = x.projectSessions ?? [];
  const where = x.project ? `trong ${x.project.name}` : "ở mọi dự án";
  if (all.length === 0) return `Chưa có phiên nào đang chạy ${where}`;
  return `Giao cùng một việc cho ${all.length} phiên ${where}: ${nameList(all)}`;
}
