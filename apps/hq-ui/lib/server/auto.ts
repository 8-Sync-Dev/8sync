// `8sync ccc auto` bridge: the HQ Pause / Run button. Fixed argv only, never user-supplied text.
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
  error?: string;
};

export const AUTO_ACTIONS = ["on", "pause"] as const;
export type AutoAction = (typeof AUTO_ACTIONS)[number];

const TIMEOUT_MS = 5000;

/** Current status; `{on:false, paused:false, error}` when 8sync is missing or answers junk (so the UI degrades, never throws). */
export async function autoStatus(): Promise<AutoStatus> {
  const r = await run("8sync", ["ccc", "auto", "status", "--json"], TIMEOUT_MS);
  if (!r.ok) return { on: false, paused: false, error: (r.stderr.trim() || "8sync ccc auto không chạy được").slice(0, 200) };
  try {
    const v = JSON.parse(r.stdout);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return { ...v, on: v.on === true, paused: v.paused === true };
  } catch {
    return { on: false, paused: false, error: "8sync ccc auto status trả JSON không hợp lệ" };
  }
}

/** Run `auto on` / `auto pause`, then return the fresh status (an error from the command is carried in `error`). */
export async function autoSet(action: AutoAction): Promise<AutoStatus> {
  const r = await run("8sync", ["ccc", "auto", action], TIMEOUT_MS);
  const st = await autoStatus();
  if (!r.ok && !st.error) st.error = (r.stderr.trim() || `auto ${action} thất bại`).slice(0, 200);
  return st;
}
