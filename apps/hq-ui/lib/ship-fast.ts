// Pure rules of the "Ship tốc độ cao" sprint (no React). The Rust side (`auto status --json`
// `ship_fast`, crates/cli/src/verbs/ccc/ship_fast.rs) already prunes expired sprints and keys them
// by canonical root; here we only pick a project's sprint across path spellings.
import { rootKey } from "./preview";

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
