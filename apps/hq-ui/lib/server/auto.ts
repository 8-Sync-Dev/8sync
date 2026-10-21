// `8sync ccc auto` bridge: the HQ Pause / Run button and the "Đội omp" switch. Fixed argv only, never user-supplied text.
import { parseGuard, type Guard } from "./guard";
import { run } from "./proc";

export type AutoStatus = {
  schema?: number;
  on: boolean;
  paused: boolean;
  idle?: boolean;
  delegate?: boolean;
  after_s?: number | null;
  lease_until?: number | null;
  gate?: string | null;
  subscription?: unknown;
  /** Teams auto drives (contract C4); absent = ["ccc"]. */
  teams?: string[];
  /** Why 8sync keeps the omp team off (e.g. omp's default model is `anthropic/…`); null when not blocked. */
  omp_blocked?: string | null;
  error?: string;
  /** Why the last "Đội omp" switch failed (e.g. omp runs on the anthropic provider); the Pause / Run state is unaffected. */
  omp_error?: string;
  /** The ccc auto resource guard (`guard` in status JSON); null when absent/invalid (older 8sync). */
  guard?: Guard | null;
};

export const AUTO_ACTIONS = ["on", "pause", "omp-on", "omp-off"] as const;
export type AutoAction = (typeof AUTO_ACTIONS)[number];

/** The only argv each action may run. */
const ARGV: Record<AutoAction, string[]> = {
  on: ["ccc", "auto", "on"],
  pause: ["ccc", "auto", "pause"],
  "omp-on": ["ccc", "auto", "omp", "on"],
  "omp-off": ["ccc", "auto", "omp", "off"],
};

const TIMEOUT_MS = 5000;

// On globalThis: route bundles may carry their own module copies; the newest status is shared.
const S = globalThis as typeof globalThis & { __hqAutoLast?: AutoStatus | null };
/** The newest status any caller fetched (GET /api/auto polls it); null before the first fetch. Spawns nothing. */
export const lastAutoStatus = () => S.__hqAutoLast ?? null;

/** Current status; `{on:false, paused:false, error}` when 8sync is missing or answers junk (so the UI degrades, never throws). */
export async function autoStatus(): Promise<AutoStatus> {
  const r = await run("8sync", ["ccc", "auto", "status", "--json"], TIMEOUT_MS);
  S.__hqAutoLast = parseStatus(r);
  return S.__hqAutoLast;
}

function parseStatus(r: { ok: boolean; stdout: string; stderr: string }): AutoStatus {
  if (!r.ok) return { on: false, paused: false, error: (r.stderr.trim() || "8sync ccc auto không chạy được").slice(0, 200) };
  try {
    const v = JSON.parse(r.stdout);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return { ...v, on: v.on === true, paused: v.paused === true, guard: parseGuard(v.guard) };
  } catch {
    return { on: false, paused: false, error: "8sync ccc auto status trả JSON không hợp lệ" };
  }
}

/**
 * Run the action's fixed argv, then return the fresh status (an error from the command is carried in `error` / `omp_error`).
 * `root` (a project HQ shows, checked by the route): `on` becomes `auto on --here` in that repo, so a
 * project's button renews that project only — a plain `on` resumes every remembered project.
 */
export async function autoSet(action: AutoAction, root?: string): Promise<AutoStatus> {
  // `on --here` in a repo also stops the team of a repo nested with it (CLI): more than 5 s.
  const r = action === "on" && root != null ? await run("8sync", [...ARGV.on, "--here"], 30_000, root) : await run("8sync", ARGV[action], TIMEOUT_MS);
  // Run pressed (a fresh owner lease): rooms that died with the machine come back now, not at the next tick.
  if (action === "on" && r.ok) void run("8sync", ["ccc", "auto", "revive"], 120_000);
  const st = await autoStatus();
  const err = (r.stderr.trim() || `auto ${action} thất bại`).slice(0, 200);
  if (!r.ok && action.startsWith("omp-")) st.omp_error = err;
  else if (!r.ok && !st.error) st.error = err;
  return st;
}
