import { stamp } from "@/lib/server/db";
import { bad, json, open, readBody } from "@/lib/server/http";
import { deliverWatched, openDialog, SessionWaiting } from "@/lib/server/channel";
import { capturePlain, sendKeys } from "@/lib/server/proc";
import { tasksFor } from "@/lib/server/queries";
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
  // Refuse before the task row exists: nothing is stored while a dialog is open.
  const waiting = await openDialog(session, capturePlain);
  if (waiting) return json({ error: "session-waiting", dialog: waiting }, 409);
  const taskId = `owner:${stamp()}`;
  const { db } = o;
  db.prepare(
    "INSERT INTO tasks(session, task_id, subject, role, prio, status, updated_at) VALUES (?, ?, ?, ?, ?, 'todo', ?)",
  ).run(session, taskId, subject.value, role, prio, stamp());
  const extra = [role && `role: ${role}`, prio && `prio: ${prio}`].filter(Boolean).join(", ");
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  let r: Awaited<ReturnType<typeof deliverWatched>>;
  try {
    r = await deliverWatched(db, session, `New task: ${subject.value}${extra ? ` (${extra})` : ""}`, {
      sendKeys,
      capture: capturePlain,
    });
  } catch (e) {
    if (!(e instanceof SessionWaiting)) throw e;
    // A dialog opened between the check and delivery: drop the task again.
    db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
    return json({ error: "session-waiting", dialog: e.dialog }, 409);
  }
  return json({ task, message: r.message, delivery: r.delivery, error: r.error }, 201);
}
