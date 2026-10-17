// `8sync ccc auto board --json` per project with a live room: the lanes view of HQ. argv only, the
// project root as cwd. 8sync prints the root the cards are filed under (`root`): a worktree shares
// its repo's board, a repo nested inside another repo keeps its own.
import type { ProjectInfo } from "../office";
import { parseBoard, type Board } from "../lanes";
import { run } from "./proc";
import { outermost } from "./targets";

const TIMEOUT_MS = 8_000;

/** `filed`: where 8sync keeps this board (null: 8sync older than 0.100.3, or the read failed). */
export type ProjectBoard = { root: string; name: string; board: Board | null; error: string | null; filed?: string | null };

export const BOARD_ARGS = ["ccc", "auto", "board", "--json"];

/** Never throws: a failure is the row's `error`. */
export async function readBoard(project: ProjectInfo): Promise<ProjectBoard> {
  const base = { root: project.root, name: project.name };
  const r = await run("8sync", BOARD_ARGS, TIMEOUT_MS, project.root);
  if (!r.ok) {
    const msg = r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s` : r.stderr.trim().replace(/^Error:\s*/, "");
    return { ...base, board: null, error: (msg || "8sync ccc auto board thất bại").slice(0, 300), filed: null };
  }
  try {
    const v = JSON.parse(r.stdout);
    const board = parseBoard(v);
    const filed = typeof v?.root === "string" && v.root ? v.root : null;
    return board ? { ...base, board, error: null, filed } : { ...base, board: null, error: "cần 8sync có board (`8sync up`)", filed: null };
  } catch {
    return { ...base, board: null, error: "cần 8sync có board (`8sync up`)", filed: null };
  }
}

/** Compare paths across `\` and `/`; Rust's canonicalize on Windows adds the `\\?\` prefix to `filed`. */
const norm = (p: string) =>
  p
    .replace(/\\/g, "/")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();

/**
 * One row per board: rooms in a repo and its worktrees read the same board, named after the root it
 * is filed under. Rows without `filed` (older 8sync, errors) fold into their outermost root as before.
 */
export function onePerBoard(read: ProjectBoard[]): ProjectBoard[] {
  const byFiled = new Map<string, ProjectBoard>();
  for (const b of read) {
    if (!b.filed) continue;
    const k = norm(b.filed);
    const cur = byFiled.get(k);
    // The room whose root is the filed root speaks for the board, else the shortest root.
    const better = !cur || (norm(cur.root) !== k && (norm(b.root) === k || b.root.length < cur.root.length));
    // Last path segment by either separator: `filed` comes from the OS 8sync runs on, not this one's `path`.
    if (better) byFiled.set(k, { ...b, name: b.filed.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || b.name });
  }
  const unknown = read.filter((b) => !b.filed);
  const keep = new Set(outermost(unknown.map((b) => ({ root: b.root, name: b.name, branch: null }))).map((p) => p.root));
  return [...byFiled.values(), ...unknown.filter((b) => keep.has(b.root))];
}

/** Every board the live projects read, once each. */
export async function projectBoards(projects: ProjectInfo[]): Promise<ProjectBoard[]> {
  return onePerBoard(await Promise.all(projects.map((p) => readBoard(p))));
}

/** argv for `8sync ccc auto prio <id> <P0..P3|none> --json`; null clears it (the card is claimed as P2). */
export function prioArgs(id: number, prio: number | null): string[] {
  return ["ccc", "auto", "prio", String(id), prio === null ? "none" : `P${prio}`, "--json"];
}

export type PrioInput = { root: string; id: number; prio: number | null };

/** `{root, id, prio}`: prio 0..3, or null to clear. */
export function parsePrioBody(b: Record<string, unknown> | null): { ok: true; value: PrioInput } | { ok: false; error: string } {
  if (!b) return { ok: false, error: "body must be a JSON object" };
  if (typeof b.root !== "string" || !b.root || b.root.length > 1024) return { ok: false, error: "root must be a project root" };
  if (typeof b.id !== "number" || !Number.isInteger(b.id) || b.id < 1 || b.id > 1e9) return { ok: false, error: "id must be a card id" };
  if (b.prio !== null && !(typeof b.prio === "number" && Number.isInteger(b.prio) && b.prio >= 0 && b.prio <= 3)) return { ok: false, error: "prio must be 0..3 or null" };
  return { ok: true, value: { root: b.root, id: b.id, prio: b.prio } };
}

/** Run `auto prio` in the project root; never throws. */
export async function setCardPrio(root: string, x: Pick<PrioInput, "id" | "prio">): Promise<{ ok: boolean; error: string | null }> {
  const r = await run("8sync", prioArgs(x.id, x.prio), TIMEOUT_MS, root);
  if (r.ok) return { ok: true, error: null };
  const msg = r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s` : r.stderr.trim().replace(/^Error:\s*/, "");
  return { ok: false, error: (msg || "8sync ccc auto prio thất bại (cần 8sync ≥ 0.100.4: `8sync up`)").slice(0, 300) };
}
