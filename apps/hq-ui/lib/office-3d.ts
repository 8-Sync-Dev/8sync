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

/** A card that changed hands since the last layout: it flies from the old desk to the new one. */
export type Handoff = { id: number; from: { x: number; z: number }; to: { x: number; z: number } };

/** Which card each desk holds now (card id → desk key). */
export function holders(desks: Desk[]): Map<number, string> {
  const m = new Map<number, string>();
  for (const d of desks) if (d.card) m.set(d.card.id, d.key);
  return m;
}

/**
 * Pure: the handoffs between two layouts — a card held by desk A before and by desk B now (B ≠ A,
 * both still on screen). A card that appears or disappears is not a handoff (claimed from or
 * returned to the board), and the first layout has none.
 */
export function handoffs(prev: Map<number, string> | null, desks: Desk[]): Handoff[] {
  if (!prev) return [];
  const at = new Map(desks.map((d) => [d.key, d]));
  const out: Handoff[] = [];
  for (const d of desks) {
    if (!d.card) continue;
    const was = prev.get(d.card.id);
    if (!was || was === d.key) continue;
    const from = at.get(was);
    if (!from) continue;
    out.push({ id: d.card.id, from: { x: from.x, z: from.z }, to: { x: d.x, z: d.z } });
  }
  return out;
}

/** Where a flying card is at progress p (0..1): straight over the floor, an arc up to `height`, ease-out. */
export function flightPoint(h: Handoff, p: number, height = 1.6): { x: number; y: number; z: number } {
  const q = Math.min(1, Math.max(0, p));
  const e = 1 - Math.pow(1 - q, 3);
  return { x: h.from.x + (h.to.x - h.from.x) * e, y: 0.7 + Math.sin(Math.PI * q) * height, z: h.from.z + (h.to.z - h.from.z) * e };
}

/** Shirts by role (who sits where reads at a glance); the state shows on the floor ring, the screen and the tag. */
export const ROLE_SHIRT: Record<string, number> = {
  lead: 0x3f6fc0, ba: 0x4f86b8, plan: 0x4f86b8, dev: 0x2fa088, fullstack: 0x2fa088, ui: 0x9a66d6, ai: 0x9a66d6,
  qa: 0xd98a4a, tester: 0xd98a4a, review: 0xc0566a, reviewer: 0xc0566a, rd: 0x8f9e3c, arch: 0x6a70c8, architect: 0x6a70c8,
};
/** The room's role (`fullstack`, `tester`…) or its crew from the name (`dev2` → `dev`). */
export const shirtOf = (role: string | null, label: string): number => ROLE_SHIRT[role ?? ""] ?? ROLE_SHIRT[label.toLowerCase().replace(/[0-9]+$/, "")] ?? 0x7a8696;
