// Layout of the 3D office (components/hq/office-3d.tsx): one floor plate per project, desks in a grid,
// one avatar per room coloured by its NowState. Pure numbers here so the scene is testable without WebGL.
// Tested in tests/office-3d.test.ts.
import type { NowState } from "./now";

export type DeskCard = { id: number; lane: string; text: string };
export type DeskIn = { key: string; label: string; state: NowState; role: string | null; /** The card the room holds (its board claim), shown on the desk. */ card?: DeskCard | null };
export type GroupIn = { project: { root: string; name: string }; rooms: DeskIn[] };

export type Floor = { root: string; name: string; x: number; z: number; w: number; d: number };
export type Desk = DeskIn & { root: string; x: number; z: number };
export type Layout = { floors: Floor[]; desks: Desk[]; width: number; depth: number };

/** World units between desk centres and the margin around a floor's desks. */
export const DESK_GAP = 2.2;
export const FLOOR_PAD = 1.4;
/** Gap between two projects' floors. */
export const FLOOR_GAP = 1.6;
/** Desks per row at most: a 13-room boost team stays a readable 5 × 3. */
export const MAX_COLS = 5;

/** OKLCH tokens of app/globals.css, as sRGB hex for the GPU (three has no oklch parser). */
export const STATE_COLOR: Record<NowState, number> = {
  needs: 0xd9822b, // --st-needs (amber)
  blocked: 0xc0392b, // red
  working: 0x3d9a5b, // --st-running (leaf green)
  holding: 0x6aa84f, // lighter green: between ticks with a card
  waiting: 0x8f949c, // --st-idle (grey)
  idle: 0x8f949c,
};

/** Floors stacked along z (one per project), desks in rows of ≤ MAX_COLS along x; (0, 0) is the scene centre. */
export function layoutOffice(groups: GroupIn[]): Layout {
  const floors: Floor[] = [];
  const desks: Desk[] = [];
  let z = 0;
  let width = 0;
  for (const g of groups) {
    const n = Math.max(1, g.rooms.length);
    const cols = Math.min(MAX_COLS, Math.ceil(Math.sqrt(n)) + (n > 4 ? 1 : 0));
    const rows = Math.ceil(n / cols);
    const w = cols * DESK_GAP + FLOOR_PAD * 2;
    const d = rows * DESK_GAP + FLOOR_PAD * 2;
    const x0 = -((cols - 1) * DESK_GAP) / 2;
    const z0 = z + FLOOR_PAD + DESK_GAP / 2;
    g.rooms.forEach((r, i) => {
      desks.push({ ...r, root: g.project.root, x: x0 + (i % cols) * DESK_GAP, z: z0 + Math.floor(i / cols) * DESK_GAP });
    });
    floors.push({ root: g.project.root, name: g.project.name, x: 0, z: z + d / 2, w, d });
    width = Math.max(width, w);
    z += d + FLOOR_GAP;
  }
  const depth = Math.max(0, z - FLOOR_GAP);
  // Centre the whole office on the origin.
  const dz = depth / 2;
  for (const f of floors) f.z -= dz;
  for (const k of desks) k.z -= dz;
  return { floors, desks, width, depth };
}

/** Camera distance that frames the office (field of view 40°, 16:9 to 4:3 viewports). */
export function cameraDistance(l: Layout): number {
  const span = Math.max(l.width, l.depth, 6);
  return span * 1.35 + 4;
}

/** The two lines on a desk's sign: the room, then its card (`#12 · qa`) or what it is doing when idle. */
export function deskSign(d: DeskIn): [string, string] {
  const second = d.card ? `#${d.card.id} · ${d.card.lane}` : d.state === "needs" ? "chờ anh" : d.state === "working" ? "đang làm" : d.state === "blocked" ? "kẹt" : "rảnh";
  return [d.label, second];
}
