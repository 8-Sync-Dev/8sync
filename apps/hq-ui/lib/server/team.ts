// Team buttons of HQ: `8sync ccc auto up [--clear-ss]` / `auto down` in a project root, so the owner
// never needs the terminal for them. argv only; the root must be a project HQ already shows.
import { stripAnsi } from "./pane";
import { run } from "./proc";

export type TeamAction = "up" | "clean" | "down";

/** `up` opens or resumes the rooms; `clean` first deletes the background sessions no room keeps. */
export function teamArgs(action: TeamAction): string[] {
  if (action === "down") return ["ccc", "auto", "down"];
  return ["ccc", "auto", "up", ...(action === "clean" ? ["--clear-ss"] : [])];
}

export const isTeamAction = (v: unknown): v is TeamAction => v === "up" || v === "clean" || v === "down";

/** Starting four background sessions takes a while; stopping them is quick. */
const TIMEOUT_MS = 180_000;

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
  try {
    const r = await run("8sync", teamArgs(action), TIMEOUT_MS, root);
    const output = tail(`${r.stdout}\n${r.stderr}`);
    if (r.ok) return { ok: true, output, error: null };
    const error = r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s; xem lại văn phòng trước khi bấm lần nữa` : tail(r.stderr, 6) || "8sync ccc auto thất bại";
    return { ok: false, output, error };
  } finally {
    inFlight.delete(key);
  }
}
