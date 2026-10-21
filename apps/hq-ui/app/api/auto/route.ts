import { AUTO_ACTIONS, autoSet, autoStatus, type AutoAction } from "@/lib/server/auto";
import { runAutoTick } from "@/lib/server/auto-tick";
import { readPublic } from "@/lib/server/auth";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";
import { runBlocked } from "@/lib/server/power";
import { versions } from "@/lib/server/version";

export const runtime = "nodejs";

/**
 * `8sync ccc auto status --json`; 200 with `error` when 8sync has no such command. `remote.host`:
 * the public tunnel host while `8sync hq ui --public` runs (never the login key).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const [status, v] = await Promise.all([autoStatus(), versions()]);
  // The server's tick loop (lib/server/auto-tick.ts) also closes stuck asks and runs "Tự soi ảnh" each
  // minute; running them here too would send a room two Esc (module state is per bundle).
  const tick = await runAutoTick(status);
  return json({ ...status, versions: v, tick, remote: { host: readPublic()?.host ?? null } });
}

/**
 * {action: "on" | "pause" | "omp-on" | "omp-off", root?}: only the fixed action word reaches the command line.
 * `root` (with `on` only; a project with a live room): `auto on --here` there — that project alone.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const action = body?.action;
  if (typeof action !== "string" || !(AUTO_ACTIONS as readonly string[]).includes(action)) return bad(`action must be one of ${AUTO_ACTIONS.join(", ")}`, 422);
  // Over today's electricity budget: the team stays paused (lib/server/power.ts) until the budget is raised.
  const blocked = action === "on" ? runBlocked() : null;
  if (blocked) return bad(blocked, 409);
  let root: string | undefined;
  if (body?.root != null) {
    if (action !== "on" || typeof body.root !== "string" || body.root.length > 1024) return bad("root: chỉ đi với action on", 422);
    const want = body.root.toLowerCase();
    root = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)).find((x) => x.root.toLowerCase() === want)?.root;
    if (!root) return bad("dự án này không có phòng nào đang chạy", 409);
  }
  return json(await (root ? autoSet(action as AutoAction, root) : autoSet(action as AutoAction)));
}
