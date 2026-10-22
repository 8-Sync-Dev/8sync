// HQ's tab bar (owner 2026-10-22: "ui ux loạn quá"): 14 tabs did not fit and read as noise. The daily
// six stay in the bar; the rest sit under one "Thêm" menu whose label becomes the open tab's name.
// Pure; components/hq/hq-app.tsx renders it. Tested in tests/tabs.test.ts.

export const MAIN_TABS = ["overview", "office", "board", "group", "room", "know"] as const;
export const MORE_TABS = ["office3d", "preview", "flow", "report", "usage", "may", "sessions", "activity"] as const;
export type MoreTab = (typeof MORE_TABS)[number];

export const MORE_LABEL: Record<MoreTab, string> = {
  office3d: "Văn phòng 3D",
  preview: "Preview",
  flow: "Flow",
  report: "Báo cáo",
  usage: "Hạn mức",
  may: "Máy",
  sessions: "Sessions",
  activity: "Activity",
};

export const isMore = (t: string): t is MoreTab => (MORE_TABS as readonly string[]).includes(t);

/** The "Thêm" button's text: the open tab when it is one of the folded ones, else "Thêm". */
export function moreLabel(tab: string): string {
  return isMore(tab) ? MORE_LABEL[tab] : "Thêm";
}
