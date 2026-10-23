// The team shapes `8sync ccc auto up` opens: the CLI's `room::DEFAULT_TEAM`, `room::FULL_TEAM` and
// `room::BOOST_TEAM` (crates/cli/src/verbs/ccc/room.rs; tests/team.test.ts pins them). The default
// team is Claude Code (owner 2026-10-23, back from omp); `--omp` (HQ's "Đội omp" switch) opens the
// omp team, rooms `omp-<role>`. Pure: the buttons' copy and lib/server/team.ts read these.
import { diskKey } from "./disk";
import { repoOf } from "./sidebar";

/** "Chạy" / "Mở lại team" (HQ "Thường"): `auto up`. */
export const DEFAULT_TEAM = ["lead", "dev", "qa"] as const;
/** "Team đầy đủ": `auto up --roles full`. */
export const FULL_TEAM = ["lead", "dev", "dev2", "ui", "qa", "review"] as const;
/** "⚡ Sấm Sét": `auto up --roles boost --hours 2`. */
export const BOOST_TEAM = ["lead", "dev", "dev2", "qa", "review"] as const;
/** The rooms only Sấm Sét opens: "Tắt Sấm Sét" stops these and the default team runs on. */
export const BOOST_ONLY: string[] = BOOST_TEAM.filter((r) => !(DEFAULT_TEAM as readonly string[]).includes(r));

/** "3 phòng (lead, dev, qa)". */
export const teamText = (team: readonly string[]) => `${team.length} phòng (${team.join(", ")})`;

/**
 * What the empty office card says (no room in view); the team buttons sit right under it. `repo`: the
 * project picked (null = all); `teamRoots`: status `team_roots`, where a team runs (the company
 * team's rooms live only there, not in auto's whole scope); `buttons`: team buttons are shown.
 * Owner 2026-10-23: it said "Bấm “Mở team” ở một dự án" with no such button, then listed every scope
 * repo as "đang chạy ở" while only one ran a team.
 */
export function emptyOfficeCopy(o: { repo: string | null; company: boolean; teamRoots: readonly string[]; buttons: boolean }): { title: string; body: string } {
  const sizes = `Mở team: ${teamText(DEFAULT_TEAM)} của đội Claude Code; ⚡ Sấm Sét: ${teamText(BOOST_TEAM)}.`;
  const title = o.repo ? (o.company ? "Dự án này chưa có phòng riêng" : "Dự án này chưa có phòng nào chạy") : "Văn phòng đang trống";
  if (!o.company) return { title, body: o.buttons ? sizes : "Thêm thư mục dự án ở mục Projects bên trái: nút “Mở team” hiện ở đây." };
  const here = o.repo ? diskKey(o.repo) : null;
  const homes = [...new Set(o.teamRoots.filter((r) => diskKey(r) !== here).map((r) => repoOf(r.replace(/^\\\\\?\\/, "")).name))];
  return {
    title,
    body: homes.length
      ? `Team công ty đang chạy ở ${homes.join(", ")}: các phòng đó nhận card của ${o.repo ? "dự án này" : "mọi dự án công ty"} khi hết việc ở dự án mình; thêm card ở Board để giao.`
      : `Công ty chưa có team nào chạy.${o.buttons ? ` ${sizes}` : ""}`,
  };
}
