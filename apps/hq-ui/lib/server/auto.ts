// `8sync ccc auto` bridge: the HQ Pause / Run button and the "Đội omp" switch. Fixed argv only, never user-supplied text.
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

let last: AutoStatus | null = null;
/** The newest status any caller fetched (GET /api/auto polls it); null before the first fetch. Spawns nothing. */
export const lastAutoStatus = () => last;

/** Current status; `{on:false, paused:false, error}` when 8sync is missing or answers junk (so the UI degrades, never throws). */
export async function autoStatus(): Promise<AutoStatus> {
  const r = await run("8sync", ["ccc", "auto", "status", "--json"], TIMEOUT_MS);
  last = parseStatus(r);
  return last;
}

function parseStatus(r: { ok: boolean; stdout: string; stderr: string }): AutoStatus {
  if (!r.ok) return { on: false, paused: false, error: (r.stderr.trim() || "8sync ccc auto không chạy được").slice(0, 200) };
  try {
    const v = JSON.parse(r.stdout);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return { ...v, on: v.on === true, paused: v.paused === true };
  } catch {
    return { on: false, paused: false, error: "8sync ccc auto status trả JSON không hợp lệ" };
  }
}

/** Run the action's fixed argv, then return the fresh status (an error from the command is carried in `error` / `omp_error`). */
export async function autoSet(action: AutoAction): Promise<AutoStatus> {
  const r = await run("8sync", ARGV[action], TIMEOUT_MS);
  // Run pressed (a fresh owner lease): rooms that died with the machine come back now, not at the next tick.
  if (action === "on" && r.ok) void run("8sync", ["ccc", "auto", "revive"], 120_000);
  const st = await autoStatus();
  const err = (r.stderr.trim() || `auto ${action} thất bại`).slice(0, 200);
  if (!r.ok && action.startsWith("omp-")) st.omp_error = err;
  else if (!r.ok && !st.error) st.error = err;
  return st;
}
