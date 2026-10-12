import { stamp } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { ownerMessage, tasksFor } from "@/lib/server/queries";
import { clampText, isTmuxName } from "@/lib/server/validate";

export const runtime = "nodejs";

const PRIOS = ["P0", "P1", "P2", "P3"];
const ROLE_RE = /^[a-z0-9][a-z0-9 _-]{0,31}$/i;

export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = new URL(req.url).searchParams.get("project");
  const project = p && /^\d+$/.test(p) ? Number(p) : null;
  return json({ tasks: tasksFor(o.db, project) });
}

export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  if (!isTmuxName(body.session)) return bad("session must be an hq-* session started here", 422);
  const subject = clampText(body.subject, 300);
  if (!subject.ok) return bad(`subject: ${subject.error}`, 422);
  const role = typeof body.role === "string" && body.role.trim() ? body.role.trim() : null;
  if (role && !ROLE_RE.test(role)) return bad("role: up to 32 letters, digits, space, '-' or '_'", 422);
  const prio = typeof body.prio === "string" && body.prio ? body.prio.toUpperCase() : null;
  if (prio && !PRIOS.includes(prio)) return bad("prio must be one of P0-P3", 422);

  const session = body.session;
  const taskId = `owner:${stamp()}`;
  const { db } = o;
  db.prepare(
    "INSERT INTO tasks(session, task_id, subject, role, prio, status, updated_at) VALUES (?, ?, ?, ?, ?, 'todo', ?)",
  ).run(session, taskId, subject.value, role, prio, stamp());
  const extra = [role && `role: ${role}`, prio && `prio: ${prio}`].filter(Boolean).join(", ");
  const message = ownerMessage(db, session, `New task: ${subject.value}${extra ? ` (${extra})` : ""}`);
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  return json({ task, message }, 201);
}
