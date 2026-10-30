// Pure rules behind the shared one-room composer (components/hq/room-send.tsx) and the Preview "Hỏi
// về ảnh này" pins. No React. Tested in tests/room-send.test.ts.
import type { ProjectInfo } from "./office";
import { groupByRepo } from "./sidebar";

type R = {
  key: string;
  name: string;
  label: string;
  cwd: string | null;
  project: ProjectInfo | null;
  delivery: "terminal" | "inbox" | null;
};

/** Rooms one message can reach (typed into its terminal or queued in its inbox), grouped by repo like the office. */
export function roomGroups<T extends R>(rooms: T[]): { root: string; name: string; rooms: T[] }[] {
  return groupByRepo(rooms.filter((r) => r.delivery != null && (r.project || r.cwd))).map((g) => ({ root: g.project.root, name: g.project.name, rooms: g.rooms }));
}

/** The room that most likely saved a screenshot: the room running in its worktree. Null: let the owner pick. */
export function imageRoom<T extends R>(item: { root: string; worktree: string | null }, rooms: T[]): T | null {
  if (!item.worktree) return null;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return rooms.find((r) => r.delivery != null && r.project && norm(r.project.root) === norm(item.root)) ?? null;
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
