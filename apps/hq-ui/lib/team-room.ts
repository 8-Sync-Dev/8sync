// Which team seat a room is, read strictly from its name (owner 2026-10-23): `lead`, `dev2`,
// `omp-qa`, `hq-review` are team rooms; the owner's own sessions (`core`, `team`, `vps`, `api-fix`)
// are not, so they never get the "Đội omp" badge, a recommendation or a reuse offer. lib/now.ts
// roomRole stays the fuzzy reader for seats on the office floor. Pure; tests/team-room.test.ts.
import type { RoleId } from "./roles";

/** The roles room.rs opens as team rooms (a trailing number = a second one of that role: `dev2`). */
export const ROOM_ROLES = ["lead", "ba", "rd", "arch", "dev", "ui", "qa", "review"] as const;
export type RoomRole = (typeof ROOM_ROLES)[number];

/** The exact team seat a room name is: `lead`, `dev2`, `omp-dev2` → `dev2`, `hq-qa` → `qa`; anything else (`core`, `lead-zus`, `hq-api`) → null. */
export function roomSlot(name: string | null | undefined): string | null {
  const m = /^(?:omp-|hq-)?([a-z]+)(\d*)$/.exec((name ?? "").trim().toLowerCase());
  return m && (ROOM_ROLES as readonly string[]).includes(m[1]) ? `${m[1]}${m[2]}` : null;
}

/** The team role of a room name: its seat without the number (`omp-dev2` → `dev`), or null. */
export function roomTeamRole(name: string | null | undefined): RoomRole | null {
  return (roomSlot(name)?.replace(/\d+$/, "") as RoomRole | undefined) ?? null;
}

/** A room of the omp team: named `omp-<role>` with a known role. The owner's own omp sessions (`core`, `team`, `vps`) are not. */
export const isOmpTeamRoom = (name: string | null | undefined): boolean => /^omp-/i.test((name ?? "").trim()) && roomSlot(name) != null;

/** The team's seats the project misses now (recommended in the Start form) and the ones a live room already holds. */
export function recommendRoles(teamRoles: readonly string[], liveRoomNames: readonly string[]): { missing: string[]; covered: string[] } {
  const live = new Set(liveRoomNames.map(roomSlot).filter((s): s is string => s != null));
  return { missing: teamRoles.filter((r) => !live.has(r)), covered: teamRoles.filter((r) => live.has(r)) };
}

/** The Start form's role (lib/roles.ts) for each team role, and back. */
const FORM_ROLE: Record<RoomRole, RoleId> = { lead: "plan", ba: "plan", rd: "rd", arch: "architect", dev: "fullstack", ui: "fullstack", qa: "tester", review: "reviewer" };
const TEAM_ROLE: Partial<Record<RoleId, RoomRole>> = { plan: "lead", rd: "rd", architect: "arch", fullstack: "dev", tester: "qa", reviewer: "review" };
export const formRoleOf = (slot: string): RoleId | null => FORM_ROLE[slot.replace(/\d+$/, "") as RoomRole] ?? null;
export const teamRoleOf = (role: string): RoomRole | null => TEAM_ROLE[role as RoleId] ?? null;

/** An idle session of the project whose name is exactly that team role (`omp-lead` for lead; never `core`, never a dev room for lead): reuse it instead of opening another. */
export function reusableSession<T extends { label: string; status: string; project_id: number | null }>(sessions: readonly T[], projectId: number | null | undefined, role: RoomRole | null): T | null {
  if (!role || projectId == null) return null;
  return sessions.find((s) => s.project_id === projectId && s.status === "idle" && roomTeamRole(s.label) === role) ?? null;
}
