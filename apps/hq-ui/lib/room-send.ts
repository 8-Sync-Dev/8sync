// Pure rules behind the shared composer (components/hq/room-send.tsx) and the Preview "Hỏi về ảnh
// này" pins. No React. Tested in tests/room-send.test.ts.
//
// Owner (2026-10-19): Chat tổng only sent to every room; he wants one room too, and to be told which
// room saves tokens. `8sync ccc msg --all "<tin>"` (crates/cli/src/verbs/ccc/msg.rs `run`) lets any
// room of a project queue a message in every other room's inbox, so one lead room can read the task
// once and hand parts out, instead of N rooms each spending a turn on it.
import { LANES, type Board, type LaneKey } from "./lanes";
import { claimMatches, roomRole } from "./now";
import type { ProjectInfo } from "./office";
import { rootKey } from "./preview";
import { groupByRepo } from "./sidebar";

type R = {
  key: string;
  name: string;
  label: string;
  cwd: string | null;
  project: ProjectInfo | null;
  delivery: "terminal" | "inbox" | null;
  role: string | null;
  tokens: number | null;
};

/** Where the composer sends: every room of a project (root, or "all" projects) or one room (its key). */
export type SendTarget = { kind: "all"; root: string } | { kind: "room"; key: string };

export const targetValue = (t: SendTarget) => (t.kind === "all" ? `all:${t.root}` : `room:${t.key}`);

export function parseTarget(v: string): SendTarget | null {
  if (v.startsWith("all:") && v.length > 4) return { kind: "all", root: v.slice(4) };
  if (v.startsWith("room:") && v.length > 5) return { kind: "room", key: v.slice(5) };
  return null;
}

/** Rooms one message can reach (typed into its terminal or queued in its inbox), grouped by repo like the office. */
export function roomGroups<T extends R>(rooms: T[]): { root: string; name: string; rooms: T[] }[] {
  return groupByRepo(rooms.filter((r) => r.delivery != null && (r.project || r.cwd))).map((g) => ({ root: g.project.root, name: g.project.name, rooms: g.rooms }));
}

/**
 * The project's lead room: named like a lead (`lead`, `pm`, `main`, `plan`…, the same table as
 * `8sync ccc` room roles) or started with the plan role. A room literally named `lead` wins.
 */
export function leadOf<T extends R>(rooms: T[]): T | null {
  const leads = rooms.filter((r) => r.delivery != null && ((roomRole(r.label) ?? roomRole(r.name))?.role === "plan" || r.role === "plan"));
  return leads.find((r) => r.label.toLowerCase() === "lead") ?? leads[0] ?? null;
}

export type Suggestion = { room: string; label: string; rooms: number; tokens: number | null; line: string };

const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} triệu` : `${Math.max(1, Math.round(n / 1000))} nghìn`);

/**
 * "Send to the lead" for one project's rooms, or null (no lead, or a lone room). The rough saving is
 * the other rooms' current context (each would spend a turn reading it); unknown for any room → only
 * the room count.
 */
export function suggestion<T extends R>(rooms: T[]): Suggestion | null {
  const lead = leadOf(rooms);
  const live = rooms.filter((r) => r.delivery != null);
  if (!lead || live.length < 2) return null;
  const others = live.filter((r) => r.key !== lead.key);
  const tokens = others.every((r) => typeof r.tokens === "number" && r.tokens > 0) ? others.reduce((n, r) => n + r.tokens!, 0) : null;
  const save = tokens != null ? `, bớt khoảng ${kTokens(tokens)} token ngữ cảnh` : "";
  return {
    room: lead.key,
    label: lead.label,
    rooms: live.length,
    tokens,
    line: `1 phòng đọc thay vì ${live.length}${save}; lead chia việc cho phòng khác bằng \`8sync ccc msg\`.`,
  };
}

/**
 * The room that most likely saved a screenshot: the one holding its card, else the room running in
 * its worktree, else the room whose role works the card's lane. Null: let the suggestion decide.
 */
export function imageRoom<T extends R>(
  item: { root: string; card: number | null; worktree: string | null },
  rooms: T[],
  boards: { root: string; board: Board | null; filed?: string | null }[],
): T | null {
  const k = rootKey(item.root);
  const mine = rooms.filter((r) => r.delivery != null && r.project && rootKey(r.project.root) === k);
  let lane: LaneKey | null = null;
  if (item.card != null) {
    for (const b of boards) {
      if (!b.board || (rootKey(b.root) !== k && (!b.filed || rootKey(b.filed) !== k))) continue;
      const card = LANES.flatMap((l) => b.board!.lanes[l.key]).find((c) => c.id === item.card);
      if (!card) continue;
      lane = card.lane;
      const holder = card.claim && mine.find((r) => claimMatches(card.claim!.room, r.label, r.name));
      if (holder) return holder;
    }
  }
  if (item.worktree) {
    const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const wt = mine.find((r) => r.project && norm(r.project.root) === norm(item.root));
    if (wt) return wt;
  }
  return (lane && mine.find((r) => (roomRole(r.label) ?? roomRole(r.name))?.lane === lane)) || null;
}

// ---- Pins on an image ----

export type Size = { w: number; h: number };
/** A pin as a fraction of the image (0..1 both ways), so it survives any display size. */
export type Pin = { fx: number; fy: number; note: string };

/** Where an `object-contain` image sits inside its box. */
export function containRect(box: Size, img: Size): { x: number; y: number; w: number; h: number } {
  const s = Math.min(box.w / img.w, box.h / img.h);
  const w = img.w * s;
  const h = img.h * s;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

/** A point in the box (CSS px from its top-left) → a pin fraction, or null on the letterbox. */
export function pointToPin(pt: { x: number; y: number }, box: Size, img: Size): { fx: number; fy: number } | null {
  const r = containRect(box, img);
  const fx = (pt.x - r.x) / r.w;
  const fy = (pt.y - r.y) / r.h;
  if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return null;
  return { fx, fy };
}

/** Pin centre in image pixels. */
export const pinPx = (p: { fx: number; fy: number }, img: Size) => ({ x: Math.round(p.fx * img.w), y: Math.round(p.fy * img.h) });

/** Marker radius drawn on the exported PNG: 3% of the short side, 12..72 px (readable when the room opens it). */
export const pinRadius = (img: Size) => Math.min(72, Math.max(12, Math.round(Math.min(img.w, img.h) * 0.03)));

const pct = (f: number) => `${(Math.round(f * 1000) / 10).toFixed(1)}%`;

/** `#2 (12.5%, 40.0%; 160 px, 288 px): nút lệch` */
export function pinLine(n: number, p: Pin, img: Size): string {
  const px = pinPx(p, img);
  const note = p.note.trim().replace(/\s+/g, " ");
  return `#${n} (${pct(p.fx)}, ${pct(p.fy)}; ${px.x} px, ${px.y} px)${note ? `: ${note}` : ""}`;
}

/** The message about one image: its path, the pins (numbered as on the marked copy) and the question. */
export function askText(o: { path: string; pins: Pin[]; img: Size | null; question: string }): string {
  const lines = [`Về ảnh: ${o.path}`];
  if (o.pins.length && o.img) {
    lines.push(`Ghim (bản có đánh số ở file đính kèm; ảnh ${o.img.w}×${o.img.h} px):`, ...o.pins.map((p, i) => pinLine(i + 1, p, o.img!)));
  }
  const q = o.question.trim();
  lines.push("", q || (o.pins.length ? "Xem các điểm đã ghim và xử lý." : "Xem ảnh này và xử lý."));
  return lines.join("\n");
}
