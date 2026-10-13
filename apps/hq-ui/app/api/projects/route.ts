import path from "node:path";
import { projectIdFor, type ProjectRow } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { validateProjectPath } from "@/lib/server/validate";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const projects = o.db.prepare("SELECT id, path, name, added_at FROM projects ORDER BY added_at").all();
  return json({ projects });
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const v = validateProjectPath(body.path);
  if (!v.ok) return bad(v.error, 422);
  const { db } = o;
  const existing = db.prepare("SELECT * FROM projects WHERE path = ?").get(v.value) as ProjectRow | undefined;
  if (existing) return json({ project: existing, existed: true });
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 80)
      : path.basename(v.value) || v.value;
  db.prepare("INSERT INTO projects(path, name, added_at) VALUES (?, ?, ?)").run(v.value, name, Date.now());
  const project = db.prepare("SELECT * FROM projects WHERE path = ?").get(v.value) as ProjectRow;
  // Sessions seen before the folder was registered now belong to it.
  const orphans = db.prepare("SELECT name, cwd FROM sessions WHERE project_id IS NULL AND cwd IS NOT NULL").all() as {
    name: string;
    cwd: string;
  }[];
  const set = db.prepare("UPDATE sessions SET project_id = ? WHERE name = ?");
  for (const s of orphans) if (projectIdFor(db, s.cwd) === project.id) set.run(project.id, s.name);
  return json({ project }, 201);
}
