import { stamp, type ProjectRow } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { listTmux, mergedSessions, startTmux } from "@/lib/server/proc";
import { toTmuxName, validateProjectPath } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ sessions: await mergedSessions(o.db) });
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const name = toTmuxName(body.name);
  if (!name.ok) return bad(name.error, 422);
  const projectId = Number(body.project);
  const project = Number.isInteger(projectId)
    ? (o.db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined)
    : undefined;
  if (!project) return bad("unknown project", 404);
  // Re-validate: the folder may have moved since it was registered.
  const dir = validateProjectPath(project.path);
  if (!dir.ok) return bad(`project folder: ${dir.error}`, 409);
  if ((await listTmux()).some((t) => t.name === name.value)) return bad(`${name.value} is already running`, 409);
  let r;
  try {
    r = await startTmux(name.value, dir.value);
  } catch (e) {
    return bad((e as Error).message, 500);
  }
  if (!r.ok) return bad(`tmux: ${r.stderr.trim() || "failed to start"}`, 502);
  const now = Date.now();
  o.db
    .prepare(
      `INSERT INTO sessions(name, project_id, started_at, status, cwd, updated_at) VALUES (?, ?, ?, 'running', ?, ?)
       ON CONFLICT(name) DO UPDATE SET project_id = excluded.project_id, started_at = excluded.started_at,
         status = 'running', cwd = excluded.cwd, updated_at = excluded.updated_at`,
    )
    .run(name.value, project.id, now, dir.value, stamp());
  return json({ session: { name: name.value, project_id: project.id, started_at: now, status: "running" } }, 201);
}
