// `8sync ccc auto add` bridge: the "Gửi cho mọi phòng" composer queues one task for every room
// of a project, the same queue and `--now` push as the terminal command. argv only (no shell),
// run with the project root as cwd; the task text goes after `--` so it is never read as a flag.
import path from "node:path";
import { groupByProject, type ProjectInfo } from "../office";
import { hasControlChars } from "./validate";
import { run } from "./proc";

/** Same caps as crates/cli/src/verbs/ccc/target.rs (TEXT_MAX, CHECK_MAX). */
export const TARGET_TEXT_MAX = 2000;
export const TARGET_CHECK_MAX = 300;
const TIMEOUT_MS = 10_000;

export type TargetInput = { text: string; now: boolean; check: string | null; root: string };
export type Sent = { name: string; now: boolean };
export type TargetResult = {
  root: string;
  name: string;
  ok: boolean;
  id: number | null;
  position: number | null;
  open: number | null;
  /** Rooms whose inbox got the task (`--now` only); `now` = the room's inbox mod is polling. */
  sent: Sent[];
  error: string | null;
};

/** `{text, now?, check?, root}` from the request; `root` is a project root or "all". */
export function parseTargetBody(b: Record<string, unknown> | null): { ok: true; value: TargetInput } | { ok: false; error: string } {
  if (!b) return { ok: false, error: "body must be a JSON object" };
  if (typeof b.text !== "string") return { ok: false, error: "text must be a string" };
  const text = b.text.replace(/\r\n/g, "\n").trim();
  if (!text) return { ok: false, error: "text is empty" };
  if (Array.from(text).length > TARGET_TEXT_MAX) return { ok: false, error: `text: at most ${TARGET_TEXT_MAX} chars` };
  if (hasControlChars(text)) return { ok: false, error: "text must not contain control characters" };
  if (b.now !== undefined && typeof b.now !== "boolean") return { ok: false, error: "now must be a boolean" };
  let check: string | null = null;
  if (b.check !== undefined && b.check !== null && b.check !== "") {
    if (typeof b.check !== "string") return { ok: false, error: "check must be a string" };
    check = b.check.trim() || null;
    if (check && (check.length > TARGET_CHECK_MAX || /[\r\n]/.test(check) || hasControlChars(check))) {
      return { ok: false, error: `check: one line, at most ${TARGET_CHECK_MAX} chars` };
    }
    // 8sync refuses a value starting with "--" (read as the next flag); no command starts with "-".
    if (check?.startsWith("-")) return { ok: false, error: "check must not start with -" };
  }
  if (typeof b.root !== "string" || !b.root || b.root.length > 1024) return { ok: false, error: "root must be a project root or all" };
  return { ok: true, value: { text, now: b.now !== false, check, root: b.root } };
}

/** argv for `8sync ccc auto add --json [--now] [--check <cmd>] -- <text>`. */
export function addArgs(x: Pick<TargetInput, "text" | "now" | "check">): string[] {
  return ["ccc", "auto", "add", "--json", ...(x.now ? ["--now"] : []), ...(x.check ? ["--check", x.check] : []), "--", x.text];
}

/** Projects with a live room, keyed like the office (git root, else the session's cwd). */
export function liveProjects(sessions: { name: string; cwd: string | null; status: string }[], projectOf: (cwd: string | null) => ProjectInfo | null): ProjectInfo[] {
  const rooms = sessions
    .filter((s) => s.status !== "ended" && s.cwd)
    .map((s) => ({ key: s.name, cwd: s.cwd, project: projectOf(s.cwd) }));
  return groupByProject(rooms).map((g) => g.project);
}

/** Drop a root that sits inside another chosen root: 8sync files both under the outer queue. */
export function outermost(projects: ProjectInfo[]): ProjectInfo[] {
  const inside = (inner: string, outer: string) => {
    const rel = path.relative(outer, inner);
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
  };
  return projects.filter((p) => !projects.some((o) => o !== p && inside(p.root, o.root)));
}

/** Run `auto add` in one project; never throws. */
export async function addTarget(project: ProjectInfo, x: TargetInput): Promise<TargetResult> {
  const base = { root: project.root, name: project.name, id: null, position: null, open: null, sent: [] as Sent[] };
  const r = await run("8sync", addArgs(x), TIMEOUT_MS, project.root);
  // Killed by the timeout after it may have written targets.json: sending again could queue a twin.
  if (!r.ok && r.killed) {
    return { ...base, ok: false, error: `8sync không trả lời sau ${TIMEOUT_MS / 1000} s; việc có thể đã vào hàng, xem \`8sync ccc auto queue\` trước khi gửi lại` };
  }
  if (!r.ok) return { ...base, ok: false, error: (r.stderr.trim().replace(/^Error:\s*/, "") || "8sync ccc auto add thất bại").slice(0, 300) };
  try {
    const v = JSON.parse(r.stdout);
    const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
    const sent = Array.isArray(v?.sent)
      ? (v.sent as unknown[]).flatMap((s) => {
          const o = s as { name?: unknown; now?: unknown };
          return typeof o?.name === "string" ? [{ name: o.name, now: o.now === true }] : [];
        })
      : [];
    return { ...base, ok: true, id: num(v?.target?.id), position: num(v?.position), open: num(v?.open), sent, error: null };
  } catch {
    return { ...base, ok: false, error: "8sync ccc auto add trả JSON không hợp lệ (cần 8sync ≥ 0.98: `8sync up`)" };
  }
}
