// `8sync ccc auto board --json` per project with a live room: the lanes view of HQ. argv only, the
// project root as cwd. 8sync prints the root the cards are filed under (`root`): a worktree shares
// its repo's board, a repo nested inside another repo keeps its own.
import type { ProjectInfo } from "../office";
import { parseBoard, type Board } from "../lanes";
import { coreCall } from "./core";
import { run } from "./proc";
import { outermost } from "./targets";

const TIMEOUT_MS = 8_000;

/** `filed`: where 8sync keeps this board (null: 8sync older than 0.100.3, or the read failed). */
export type ProjectBoard = { root: string; name: string; board: Board | null; error: string | null; filed?: string | null };

export const BOARD_ARGS = ["ccc", "auto", "board", "--json"];

/** Never throws: a failure is the row's `error`. The core reads the board in process; else one `8sync` per root. */
export async function readBoard(project: ProjectInfo): Promise<ProjectBoard> {
  const base = { root: project.root, name: project.name };
  const fail = (msg: string) => ({ ...base, board: null, error: (msg || "8sync ccc auto board thất bại").slice(0, 300), filed: null });
  let v: unknown;
  const c = await coreCall(`/v1/board?root=${encodeURIComponent(project.root)}`, { timeoutMs: TIMEOUT_MS });
  if (c && (c.status === 200 || c.status === 422)) {
    if (c.status === 422) return fail(String((c.body as { error?: unknown } | null)?.error ?? ""));
    v = c.body;
  } else {
    const r = await run("8sync", BOARD_ARGS, TIMEOUT_MS, project.root);
    if (!r.ok) return fail(r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s` : r.stderr.trim().replace(/^Error:\s*/, ""));
    try {
      v = JSON.parse(r.stdout);
    } catch {
      return { ...base, board: null, error: "cần 8sync có board (`8sync up`)", filed: null };
    }
  }
  const board = parseBoard(v);
  const root = (v as { root?: unknown } | null)?.root;
  const filed = typeof root === "string" && root ? root : null;
  return board ? { ...base, board, error: null, filed } : { ...base, board: null, error: "cần 8sync có board (`8sync up`)", filed: null };
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

/** The office (every poll, auto-tick, …) and the board route ask for the same boards: one read per root serves them all for this long. */
const BOARDS_TTL_MS = 3_000;
const memo = new Map<string, { at: number; board: Promise<ProjectBoard> }>();

/** Forget the memoised boards: after a write (prio, unblock) the next read is fresh. */
export function resetBoards(): void {
  memo.clear();
}

function memoBoard(p: ProjectInfo, now: number): Promise<ProjectBoard> {
  const hit = memo.get(p.root);
  if (hit && now - hit.at < BOARDS_TTL_MS) return hit.board;
  const board = readBoard(p);
  // A rejected read (never expected: readBoard answers an error row) is not served for 3 s.
  board.catch(() => memo.delete(p.root));
  memo.set(p.root, { at: now, board });
  return board;
}

/** Every board the live projects read, once each (at most once per BOARDS_TTL_MS per root). */
export function projectBoards(projects: ProjectInfo[], now = Date.now()): Promise<ProjectBoard[]> {
  return Promise.all(projects.map((p) => memoBoard(p, now))).then(onePerBoard);
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

/**
 * One line for the "⚡ Làm ngay" toast from `auto prio --json` (`rushed`, `lead`, `lead_recent`,
 * `woke`, `held`: the owner's P0 on a board team mails the lead, once per card per 10 min, and calls
 * the rooms that take the card now); null when nobody was told (a lower level, no team, an older 8sync).
 */
export function rushLine(stdout: string, id: number): string | null {
  let v: { rushed?: unknown; lead?: unknown; lead_recent?: unknown; woke?: unknown; held?: unknown };
  try {
    v = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (v?.rushed !== true) return null;
  const names = (x: unknown) => (Array.isArray(x) ? x.map((r) => (r && typeof r.name === "string" ? r.name : null)).filter((n): n is string => !!n) : []);
  const woke = names(v.woke);
  const lead = names(v.lead).length > 0 ? "đã báo lead" : v.lead_recent === true ? "lead đã được báo" : null;
  const head = woke.length
    ? `Đã gọi ${woke.join(", ")} nhận #${id} ngay`
    : typeof v.held === "string" && v.held
      ? `${v.held} đang giữ #${id}`
      : `Chưa phòng nào rảnh nhận #${id}`;
  return lead ? `${head} · ${lead}` : head;
}

/** Run `auto prio` in the project root; never throws. `woke`: [rushLine]. */
export async function setCardPrio(root: string, x: Pick<PrioInput, "id" | "prio">): Promise<{ ok: boolean; error: string | null; woke: string | null }> {
  const r = await run("8sync", prioArgs(x.id, x.prio), TIMEOUT_MS, root);
  if (r.ok) {
    resetBoards();
    return { ok: true, error: null, woke: rushLine(r.stdout, x.id) };
  }
  const msg = r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s` : r.stderr.trim().replace(/^Error:\s*/, "");
  return { ok: false, error: (msg || "8sync ccc auto prio thất bại (cần 8sync ≥ 0.100.4: `8sync up`)").slice(0, 300), woke: null };
}

/** The note "⚡ Gỡ block ngay" leaves on the card: what the lead does with it this turn. */
export const UNBLOCK_NOTE = "owner: gỡ block ngay — lead quyết + viết AC + check, đưa ready lượt này";

/** argv for `8sync ccc auto move <id> backlog --note …`: the card leaves Blocked for the lead. */
export function unblockArgs(id: number): string[] {
  return ["ccc", "auto", "move", String(id), "backlog", "--note", UNBLOCK_NOTE];
}

/**
 * "⚡ Gỡ block ngay" (owner 2026-10-20): Blocked → Backlog with the owner's note, then P0, so the lead
 * wakes at once to decide, write AC and the check, and send it to Ready. Never throws.
 */
export async function unblockCard(root: string, id: number): Promise<{ ok: boolean; error: string | null; woke: string | null }> {
  const r = await run("8sync", unblockArgs(id), TIMEOUT_MS, root);
  if (!r.ok) {
    const msg = r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s` : r.stderr.trim().replace(/^Error:\s*/, "");
    return { ok: false, error: (msg || "8sync ccc auto move thất bại").slice(0, 300), woke: null };
  }
  resetBoards();
  return setCardPrio(root, { id, prio: 0 });
}
