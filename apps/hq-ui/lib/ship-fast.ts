// Pure rules of the "Ship tốc độ cao" sprint (no React). The Rust side (`auto status --json`
// `ship_fast`, crates/cli/src/verbs/ccc/ship_fast.rs) already prunes expired sprints and keys them
// by canonical root; here we only pick a project's sprint across path spellings.
import { rootKey } from "./preview";

/** The sprint lengths the owner may pick (owner 2026-10-23: "chỉnh time được, chọn được, mặc định là 30p"). */
export const SHIP_HOURS = [0.5, 1, 2, 4] as const;
export type ShipHours = (typeof SHIP_HOURS)[number];
/** The default sprint, also the one Sấm Sét starts with its rooms. */
export const DEFAULT_SHIP_HOURS: ShipHours = 0.5;
export const isShipHours = (v: unknown): v is ShipHours => (SHIP_HOURS as readonly unknown[]).includes(v);
/** "30 phút", "1 giờ", "2 giờ", "4 giờ". */
export const hoursLabel = (h: ShipHours): string => (h < 1 ? `${h * 60} phút` : `${h} giờ`);

export type Sprint = { root: string; until: number; since: number | null };

type Raw = Record<string, { until?: unknown; since?: unknown }>;

/** `ship_fast` → live sprints only; anything else (older 8sync, junk) → none. */
export function sprintsOf(v: unknown): Sprint[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Raw).flatMap(([root, s]) =>
    typeof s?.until === "number" ? [{ root, until: s.until, since: typeof s.since === "number" ? s.since : null }] : [],
  );
}

/** The sprint of project `root` (`\` vs `/`, case and Rust's `\\?\` prefix ignored), or null. */
export function sprintFor(sprints: Sprint[], root: string): Sprint | null {
  const k = rootKey(root);
  return sprints.find((s) => rootKey(s.root) === k) ?? null;
}
