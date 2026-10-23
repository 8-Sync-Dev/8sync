// The team shapes `8sync ccc auto up` opens: the CLI's `room::DEFAULT_TEAM`, `room::FULL_TEAM` and
// `room::BOOST_TEAM` (crates/cli/src/verbs/ccc/room.rs; tests/team.test.ts pins them). The default
// engine is omp (rooms `omp-<role>`, owner 2026-10-23 "all mặc định là omp"); `--ccc` opens the same
// roles as Claude Code rooms. Pure: the buttons' copy and lib/server/team.ts read these.

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
 * What the empty office says (no room in view). `repo`: one project picked; `company`: `auto company
 * on`; `homes`: projects where the company team's rooms live now; `starters`: projects with team
 * buttons right below. Owner 2026-10-23: it said "Bấm “Mở team” ở một dự án" with no such button,
 * and "chưa có phòng nào chạy" while the company team ran in another project.
 */
export function emptyOfficeCopy(o: { repo: boolean; company: boolean; homes: readonly string[]; starters: number }): { title: string; body: string } {
  const open = `Bấm “Mở team” bên dưới: ${teamText(DEFAULT_TEAM)} của đội omp; “⚡ Sấm Sét”: ${teamText(BOOST_TEAM)}.`;
  if (o.company && o.homes.length) {
    const where = o.homes.join(", ");
    return {
      title: o.repo ? "Dự án này chưa có phòng riêng" : "Chưa phòng nào làm ở đây",
      body: `Team công ty đang chạy ở ${where}: các phòng đó nhận card của ${o.repo ? "dự án này" : "mọi dự án công ty"} khi hết việc ở dự án mình; thêm card ở Board để giao.${o.starters ? ` Cần phòng riêng: ${open}` : ""}`,
    };
  }
  return {
    title: o.repo ? "Dự án này chưa có phòng nào chạy" : "Văn phòng đang trống",
    body: o.starters ? open : "Thêm thư mục dự án ở mục Projects bên trái: nút “Mở team” hiện ở đây.",
  };
}
