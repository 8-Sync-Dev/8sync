// HQ's tab bar (owner 2026-10-22: "ui ux loạn quá"): 14 tabs did not fit and read as noise. The daily
// daily ones stay in the bar; the rest sit under one "Thêm" menu whose label becomes the open tab's name.
// Pure; components/hq/hq-app.tsx renders it. Tested in tests/tabs.test.ts.

// Owner 2026-10-22 again ("nhiều chữ nhiều tab đang bị rối"): four in the bar; "room" (Chat phòng) only
// while a room is open, Tri thức joins the menu.
// Preview is back in the bar (owner 2026-10-22: "Tab preview rất quan trọng … ưu tiên xem được kết quả").
// Không gian (owner 2026-11-02, omp-first): folders on the machine → omp sessions → several windows; first and the default tab.
export const MAIN_TABS = ["workspace", "overview", "office", "preview", "group", "room"] as const;
// Nội dung (2026-11-04): content-post-agency's registry; listed only while a content DB is configured.
export const MORE_TABS = ["know", "content", "loops", "report", "usage", "may", "sessions", "activity"] as const;
export type MoreTab = (typeof MORE_TABS)[number];

export const MORE_LABEL: Record<MoreTab, string> = {
  know: "Tri thức",
  content: "Nội dung",
  loops: "Vòng lặp",
  report: "Báo cáo",
  usage: "Hạn mức",
  may: "Máy",
  sessions: "Sessions",
  activity: "Activity",
};

export const isMore = (t: string): t is MoreTab => (MORE_TABS as readonly string[]).includes(t);

/** The folded tabs on offer: "content" only while a content DB is configured (GET /api/content?probe=1). */
export function moreTabs(contentOn: boolean): readonly MoreTab[] {
  return contentOn ? MORE_TABS : MORE_TABS.filter((t) => t !== "content");
}

/** The "Thêm" button's text: the open tab when it is one of the folded ones, else "Thêm". */
export function moreLabel(tab: string): string {
  return isMore(tab) ? MORE_LABEL[tab] : "Thêm";
}

/** The bar's tabs now: "room" only while a room is open (its chat). */
export function barTabs(roomOpen: boolean): readonly string[] {
  return roomOpen ? MAIN_TABS : MAIN_TABS.filter((t) => t !== "room");
}
