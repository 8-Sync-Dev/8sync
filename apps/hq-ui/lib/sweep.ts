// "Dọn máy tự động" (Máy tab, "Bảo vệ máy"): while HQ runs, every project whose team runs and whose
// switch is on (default on) has one `sweep` room (crates/cli/src/verbs/ccc/team.rs `sweep_prompt`):
// it waits on its inbox and acts only on HQ's guard breaches (lib/server/guard-trigger.ts, projects
// whose own rooms carry the load) and disk findings (lib/server/cleanup-loop.ts), cleans only what
// is provably safe, messages the room that causes the load and tells the lead what it freed.
// Pure: lib/server/sweep.ts runs the commands.

export const SWEEP_ROOM = "sweep";
/** The ensure pass runs this often (lib/server/sweep.ts startSweepLoop). */
export const ENSURE_EVERY_MS = 60_000;
/** After an `auto up --add sweep` that worked, the same project is not asked again before this (a room list that misses the room never storms the CLI). */
export const ENSURE_AGAIN_MS = 10 * 60_000;
/** A failed `auto up --add sweep` waits this long, doubling up to the max. */
export const BACKOFF_MIN_MS = 5 * 60_000;
export const BACKOFF_MAX_MS = 60 * 60_000;
/** At most one `[máy]` alert per project this often. */
export const ALERT_EVERY_MS = 5 * 60_000;

export const sweepArgs = (on: boolean) => (on ? ["ccc", "auto", "up", "--add", SWEEP_ROOM] : ["ccc", "auto", "down", "--only", SWEEP_ROOM]);

/** A room named like the sweep (`sweep`, `sweep2`, `sweep-zus` when `auto up` titled it after the repo), as room.rs `find` reads names. */
export function isSweepRoom(label: string | null | undefined): boolean {
  const first = (label ?? "").toLowerCase().split(/[^\p{L}\p{N}&]+/u).find(Boolean) ?? "";
  return first.replace(/\d+$/, "").startsWith(SWEEP_ROOM);
}

/** The next wait after a failure (`prev`: the last wait, null = first failure). */
export const nextBackoff = (prev: number | null) => (prev == null ? BACKOFF_MIN_MS : Math.min(prev * 2, BACKOFF_MAX_MS));

/** The one-line alert the guard trigger mails the sweep: why it fired, the project's top CPU eaters. */
export function alertText(why: string, top: readonly string[]): string {
  const t = top.length ? ` · top: ${top.join(", ")}` : "";
  return `[máy] ${why}${t}. Xem tiến trình (một lần guard --dry-run), nhắn đúng phòng gây tải theo luật của phòng`;
}

/**
 * The guard's last pass for one project shows the load is that project's own: one of its top CPU
 * users (pressure.rs `cpu_top`: "node 24% (dev2)", owner "máy" = not a room) belongs to one of its
 * rooms at ≥ 1 %. The level does not count: it is machine-wide, the same in every project's pass.
 * Only those projects' sweeps get a `[máy]` alert.
 */
export function loadIsTheirs(p: { level: number; top: readonly string[] } | null | undefined): boolean {
  if (!p) return false;
  return p.top.some((t) => {
    const m = /(\d+(?:\.\d+)?)% \(([^()]+)\)\s*$/.exec(t);
    return m != null && Number(m[1]) >= 1 && m[2] !== "máy";
  });
}
