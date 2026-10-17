// `8sync ccc auto board --json` per project with a live room: the lanes view of HQ. argv only, the
// project root as cwd (8sync files the board under the outermost project root, like the queue).
import type { ProjectInfo } from "../office";
import { parseBoard, type Board } from "../lanes";
import { run } from "./proc";

const TIMEOUT_MS = 8_000;

export type ProjectBoard = { root: string; name: string; board: Board | null; error: string | null };

export const BOARD_ARGS = ["ccc", "auto", "board", "--json"];

/** Never throws: a failure is the row's `error`. */
export async function readBoard(project: ProjectInfo): Promise<ProjectBoard> {
  const base = { root: project.root, name: project.name };
  const r = await run("8sync", BOARD_ARGS, TIMEOUT_MS, project.root);
  if (!r.ok) {
    const msg = r.killed ? `8sync không trả lời sau ${TIMEOUT_MS / 1000} s` : r.stderr.trim().replace(/^Error:\s*/, "");
    return { ...base, board: null, error: (msg || "8sync ccc auto board thất bại").slice(0, 300) };
  }
  try {
    const board = parseBoard(JSON.parse(r.stdout));
    return board ? { ...base, board, error: null } : { ...base, board: null, error: "cần 8sync có board (`8sync up`)" };
  } catch {
    return { ...base, board: null, error: "cần 8sync có board (`8sync up`)" };
  }
}
