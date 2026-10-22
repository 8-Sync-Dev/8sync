// "Ship tất cả" on the Approved column (owner 2026-10-22: "kẹt suốt vậy auto ship mà nên có thêm nút ở
// ví dụ ship all"): 21 approved cards sat while the lead's Ship question waited in the ask panel.
// Pure rules here; the button in components/hq/lanes-view.tsx does the posting. Tested in tests/ship-all.test.ts.
import type { Ask } from "./ask";
import { rootKey } from "./preview";

export type ShipRoom = { session_id: string | null; delivery?: "terminal" | "inbox" | null; project: { root: string } | null; ask: Ask | null };

/** The Ship question a project's room holds open for the owner, and the option that approves everything. */
export type ShipAsk = { sid: string; label: string; key: string };

/** `Ship` header, one single-choice question with options: what one tap may answer (see ask-panel oneTapKind). */
export function shipQuestion(a: Ask | null | undefined) {
  if (a?.kind !== "question" || a.questions.length !== 1) return null;
  const q = a.questions[0];
  if ((q.header ?? "").trim().toLowerCase() !== "ship" || q.multi || q.options.length === 0) return null;
  return q;
}

/** The pending Ship question of the project at `root` (a terminal room cannot be answered from the web). */
export function shipAskOf<T extends ShipRoom>(rooms: T[], root: string): ShipAsk | null {
  const k = rootKey(root);
  for (const r of rooms) {
    if (!r.session_id || r.delivery === "terminal" || !r.project || rootKey(r.project.root) !== k) continue;
    const q = shipQuestion(r.ask);
    if (!q) continue;
    // "Duyệt tất cả (Recommended)" by name, else the recommended one, else the first.
    let i = q.options.findIndex((o) => /duyệt tất cả/i.test(o.label));
    if (i < 0) i = q.options.findIndex((o) => /recommended/i.test(o.label));
    if (i < 0) i = 0;
    return { sid: r.session_id, label: q.options[i].label, key: String(i + 1) };
  }
  return null;
}
