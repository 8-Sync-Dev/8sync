// A room's display name. A resumed background room used to be titled after its /goal prompt
// ("/goal Phòng `qa` (vai QA: …", seen live 2026-10-18; `auto up` now passes --name on resume):
// show the room name inside it, and cut anything else long so a title never floods the page.
const GOAL_TITLE = /^\/goal\s+Phòng\s+`([^`]{1,40})`/;
export const LABEL_MAX = 32;

export function roomLabel(name: string | null | undefined, fallback = ""): string {
  const t = (name ?? "").trim();
  const m = GOAL_TITLE.exec(t);
  if (m) return m[1];
  if (!t) return fallback;
  return t.length > LABEL_MAX ? `${t.slice(0, LABEL_MAX - 1)}…` : t;
}
