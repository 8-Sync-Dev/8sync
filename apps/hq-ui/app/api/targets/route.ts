import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { projectBoards } from "@/lib/server/board";
import { addTarget, liveProjects, parseTargetBody, type TargetResult } from "@/lib/server/targets";

export const runtime = "nodejs";

/**
 * {text, now?, check?, root}: `8sync ccc auto add` in that project (root = "all": every project
 * with a live room). Only a root the office shows right now is accepted, never an arbitrary path.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = parseTargetBody(await readBody(req));
  if (!p.ok) return bad(p.error, 422);
  const projects = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd));
  // Case-insensitive like the office grouping (lib/office.ts groupByProject).
  const want = p.value.root.toLowerCase();
  // "all": once per board (a nested repo has its own; a worktree shares its repo's).
  const boardRoots = p.value.root === "all" ? new Set((await projectBoards(projects)).map((b) => b.root)) : null;
  const chosen = boardRoots ? projects.filter((x) => boardRoots.has(x.root)) : projects.filter((x) => x.root.toLowerCase() === want);
  if (chosen.length === 0) {
    return bad(p.value.root === "all" ? "chưa có phòng nào đang chạy" : "dự án này không còn phòng nào đang chạy", 409);
  }
  const results: TargetResult[] = [];
  // One project at a time: each run takes the shared targets.lock anyway.
  for (const project of chosen) results.push(await addTarget(project, p.value));
  return json({ results });
}
