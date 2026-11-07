// HQ's navigation. Owner 2026-11-07 ("ui ux hoàn toàn mới … giống Grok Bot"): HQ is built around bots,
// so the bar holds four places: Bots (the roster and a bot's page), Nhóm, Tìm and Thêm. Every other view
// (Tổng quan, Văn phòng, Preview, Không gian, …) sits under Thêm; their tab ids stay as they were, so a
// saved tab, a deep link or a keyboard shortcut still opens them. Pure; components/hq/hq-app.tsx,
// sidebar.tsx and bottom-tabs.tsx render it. Tested in tests/tabs.test.ts.

export const NAV = ["bots", "groups", "search", "more"] as const;
export type NavItem = (typeof NAV)[number];

export const NAV_LABEL: Record<NavItem, string> = {
  bots: "Bots",
  groups: "Nhóm",
  search: "Tìm",
  more: "Thêm",
};

// Kết quả (2026-11-04): files a room registered for the owner (POST /api/artifacts).
// Bản đồ code (2026-11-05): a registered project's trail code map (app/api/codemap).
// Nội dung (2026-11-04): content-post-agency's registry; listed only while a content DB is configured.
// Chat phòng: only while a room is open. Phiên & dự án: the old session tree, worktrees included.
export const MORE_TABS = [
  "overview",
  "office",
  "preview",
  "workspace",
  "tree",
  "group",
  "room",
  "artifacts",
  "codemap",
  "know",
  "content",
  "loops",
  "report",
  "usage",
  "may",
  "sessions",
  "activity",
] as const;
export type MoreTab = (typeof MORE_TABS)[number];

export const MORE_LABEL: Record<MoreTab, string> = {
  overview: "Tổng quan",
  office: "Văn phòng",
  preview: "Preview",
  workspace: "Không gian",
  tree: "Phiên & dự án",
  group: "Chat chung",
  room: "Chat phòng",
  artifacts: "Kết quả",
  codemap: "Bản đồ code",
  know: "Tri thức",
  content: "Nội dung",
  loops: "Vòng lặp",
  report: "Báo cáo",
  usage: "Hạn mức",
  may: "Máy",
  // Vietnamese like the rest of the menu (UI audit 2026-11-07: "Sessions"/"Activity" were the only English).
  sessions: "Quản lý phiên",
  activity: "Hoạt động",
};

export const isMore = (t: string): t is MoreTab => (MORE_TABS as readonly string[]).includes(t);

/** Which of the four places a tab belongs to: Bots, Nhóm and Tìm are their own; every other view is under Thêm. */
export function navOf(tab: string): NavItem {
  return tab === "bots" || tab === "groups" || tab === "search" ? tab : "more";
}

/** Thêm's views on offer: "content" only while a content DB is configured, "room" only while a room is open. */
export function moreTabs(contentOn: boolean, roomOpen: boolean): readonly MoreTab[] {
  return MORE_TABS.filter((t) => (t !== "content" || contentOn) && (t !== "room" || roomOpen));
}

/** The "Thêm" item's text: the open view when it is one of Thêm's, else "Thêm". */
export function moreLabel(tab: string): string {
  return isMore(tab) ? MORE_LABEL[tab] : NAV_LABEL.more;
}

// The views that list rooms/projects keep the room/project header ("Tất cả phòng · 6 dự án · 11 phòng",
// a project, a room). Every other view is titled by its own name (UAT 2026-11-07: "Bản đồ code" and
// "Máy" were headed "Tất cả phòng"). The repo-filtered ones name the repo they show.
const ROOM_VIEWS: readonly string[] = ["overview", "office", "room", "group", "sessions"];
const REPO_VIEWS: readonly string[] = ["preview", "loops", "know", "artifacts", "report"];

/** The header of a view that is not a room/project list; null = the room/project header. */
export function viewHeader(tab: string, repoName: string | null): { title: string; subtitle: string } | null {
  if (ROOM_VIEWS.includes(tab)) return null;
  const title = isMore(tab) ? MORE_LABEL[tab] : tab === "groups" || tab === "search" ? NAV_LABEL[tab] : null;
  if (title == null) return null;
  return { title, subtitle: repoName && REPO_VIEWS.includes(tab) ? repoName : "" };
}
