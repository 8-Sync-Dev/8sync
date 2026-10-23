// `8sync ccc auto` bridge: the HQ Pause / Run button, the "Đội omp" and "Lease liên tục" switches. Fixed argv only, never user-supplied text.
import type { LeaseRest } from "../auto";
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
  /** Repos whose team `auto up` brought up; absent on an older 8sync. `repos`: auto's scope (none = every project); `out`: projects `auto close` took out. Unvalidated: read via lib/server/sweep.ts runningTeams. */
  team_roots?: unknown;
  repos?: unknown;
  /** `auto company on`: one team for every project in scope (v0.110.40). */
  company?: boolean;
  out?: unknown;
  /** Why 8sync keeps the omp team off (e.g. omp's default model is `anthropic/…`); null when not blocked. */
  omp_blocked?: string | null;
  /** The omp team's model (`<provider>/<model>`, `auto omp on --model`); null = omp's own default; absent on an older 8sync. */
  omp_model?: string | null;
  /** The omp team's own hours (`auto omp on --hours`, unix s); null when unset. */
  omp_until?: number | null;
  /** Each project's engine (`auto up` `--ccc`/`--omp`/default), keyed by canonical root like `team_roots`: "omp" | "ccc" | "both"; no key = never chosen (fall back to `teams`). Unvalidated: read via lib/sweep.ts sweepAllowed. */
  engines?: unknown;
  error?: string;
  /** Why the last "Đội omp" switch failed (e.g. omp runs on the anthropic provider); the Pause / Run state is unaffected. */
  omp_error?: string;
  /** The ccc auto resource guard (`guard` in status JSON); null when absent/invalid (older 8sync). */
  guard?: Guard | null;
  /** `auto loop` per project root (`{round, focus, since, last}`); read via lib/slash.ts shipLoops. */
  ship_loops?: unknown;
  /** `ship_fast` per project root (`{on, since, until}`); the live "Ship tốc độ cao" sprints. */
  ship_fast?: unknown;
  /** "Lease liên tục" (`8sync ccc auto lease auto on|off`), its last renewal (unix s) and why auto rests; absent on an older 8sync. */
  lease_auto?: boolean;
  lease_renewed_at?: number | null;
  lease_rest?: LeaseRest | null;
  /** The $/hour budget of the lease (API key: always set). */
  usd_per_hour?: number | null;
  /** Usage is tight and projects are pinned: only pinned projects work. `pins`: pinned roots, oldest first. */
  focus?: boolean;
  pins?: string[];
  /** Why the last "Lease liên tục" switch failed; the Pause / Run state is unaffected. */
  lease_error?: string;
};

export const AUTO_ACTIONS = ["on", "pause", "omp-on", "omp-off", "lease-auto-on", "lease-auto-off", "critic-on", "critic-off", "company-on", "company-off"] as const;
export type AutoAction = (typeof AUTO_ACTIONS)[number];

/** The only argv each action may run. */
const ARGV: Record<AutoAction, string[]> = {
  on: ["ccc", "auto", "on"],
  pause: ["ccc", "auto", "pause"],
  "omp-on": ["ccc", "auto", "omp", "on"],
  "omp-off": ["ccc", "auto", "omp", "off"],
  "lease-auto-on": ["ccc", "auto", "lease", "auto", "on"],
  "lease-auto-off": ["ccc", "auto", "lease", "auto", "off"],
  "critic-on": ["ccc", "delegate", "on"],
  "critic-off": ["ccc", "delegate", "off"],
  "company-on": ["ccc", "auto", "company", "on"],
  "company-off": ["ccc", "auto", "company", "off"],
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
  else if (!r.ok && action.startsWith("lease-")) st.lease_error = err;
  else if (!r.ok && !st.error) st.error = err;
  return st;
}

/**
 * `/hq-auto-ship` / `/hq-stop` (lib/slash.ts): `8sync ccc auto loop on [-- <trọng tâm>] | off` in a
 * project root the route checked; the focus is one argv word after `--`, never shell text.
 * Refreshes the status cache so the "Auto-ship: vòng N" chip shows at the next poll.
 */
export async function loopSet(root: string, on: boolean, focus: string | null, wake = false): Promise<{ ok: boolean; line: string; error: string | null }> {
  const argv = wake ? ["ccc", "auto", "loop", "wake", "--json"] : ["ccc", "auto", "loop", on ? "on" : "off", "--json", ...(on && focus ? ["--", focus] : [])];
  const r = await run("8sync", argv, TIMEOUT_MS, root);
  await autoStatus();
  if (!r.ok) return { ok: false, line: "", error: (r.stderr.trim().replace(/^Error:\s*/, "") || "8sync ccc auto loop thất bại (cần 8sync có `auto loop`)").slice(0, 300) };
  if (wake) return { ok: true, line: "Auto-ship: chạy lại", error: null };
  return { ok: true, line: on ? "Auto-ship: BẬT — 8sync gửi lead vòng kế khi board cạn (≥ 20 phút một vòng)" : "Auto-ship: TẮT — các card đang làm vẫn xong theo luồng thường", error: null };
}
