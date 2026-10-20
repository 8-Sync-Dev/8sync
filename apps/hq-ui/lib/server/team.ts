// Team buttons of HQ: `8sync ccc auto up [--clear-ss]` / `auto down` in a project root, so the owner
// never needs the terminal for them. argv only; the root must be a project HQ already shows.
import { stripAnsi } from "./pane";
import { run } from "./proc";

export type TeamAction = "up" | "full" | "boost" | "clean" | "down";

/**
 * `up` opens or resumes the 5-room team; `full` the 6-room builder-heavy team (`--roles full`); `boost`
 * (HQ "Sấm Sét") the 13-room team with a 2-hour lease (renews it when already running); `clean` first
 * deletes the background sessions no room keeps and restarts rooms that run an older kit.
 */
export function teamArgs(action: TeamAction): string[] {
  if (action === "down") return ["ccc", "auto", "down"];
  if (action === "full") return ["ccc", "auto", "up", "--roles", "full"];
  if (action === "boost") return ["ccc", "auto", "up", "--roles", "boost", "--hours", "2"];
  return ["ccc", "auto", "up", ...(action === "clean" ? ["--clear-ss"] : [])];
}

export const isTeamAction = (v: unknown): v is TeamAction => v === "up" || v === "full" || v === "boost" || v === "clean" || v === "down";

/** `busy`: another team run is still going in this root (a second tab, a double click). */
export type TeamResult = { ok: boolean; output: string; error: string | null; busy?: boolean };

/** Roots with a team run in flight: `--clear-ss` deletes sessions, so two runs must never overlap. */
const inFlight = new Set<string>();

/** The last lines of the CLI's own report, without colour codes. */
export function tail(text: string, lines = 24): string {
  return stripAnsi(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(-lines)
    .join("\n")
    .slice(0, 4000);
}

export async function runTeam(root: string, action: TeamAction): Promise<TeamResult> {
  const key = root.replace(/\\/g, "/").toLowerCase();
  if (inFlight.has(key)) return { ok: false, output: "", error: "team của dự án này đang mở/dừng, đợi lần trước xong", busy: true };
  inFlight.add(key);
  // Starting four background sessions takes a while; boost starts thirteen `claude --bg` rooms one by
  // one (up to ~10 minutes on Windows). Stopping is quick.
  const ms = action === "boost" ? 660_000 : 180_000;
  try {
    const r = await run("8sync", teamArgs(action), ms, root);
    const output = tail(`${r.stdout}\n${r.stderr}`);
    if (r.ok) {
      // Boost sets a fresh owner lease, like the Run button: rooms that died with the machine come back now.
      if (action === "boost") void run("8sync", ["ccc", "auto", "revive"], 120_000);
      return { ok: true, output, error: null };
    }
    const error = r.killed ? `8sync không trả lời sau ${ms / 1000} s; xem lại văn phòng trước khi bấm lần nữa` : tail(r.stderr, 6) || "8sync ccc auto thất bại";
    return { ok: false, output, error };
  } finally {
    inFlight.delete(key);
  }
}
