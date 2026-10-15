import type { DatabaseSync } from "node:sqlite";
import { isModelId, isRoleId, roleOf, type RoleId } from "@/lib/roles";
import { stamp, type ProjectRow } from "@/lib/server/db";
import { startHqSession } from "@/lib/server/start";
import { bad, json, open, readBody } from "@/lib/server/http";
import { deliverWatched, openDialog, SessionWaiting } from "@/lib/server/channel";
import { capturePlain, listTmux, sendKeys } from "@/lib/server/proc";
import { isSessionId, queueInbox } from "@/lib/server/inbox";
import { ownerMessage, tasksFor } from "@/lib/server/queries";
import { clampText, isTmuxName, validateProjectPath } from "@/lib/server/validate";
import { parseSchedule, scheduleLabel, scheduledPrompt } from "@/lib/schedule";

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
  const hasSession = body.session != null && body.session !== "";
  const inbox = hasSession && isSessionId(body.session);
  if (hasSession && !inbox && !isTmuxName(body.session)) return bad("session must be an hq-* session or a Claude session id", 422);
  const subject = clampText(body.subject, 300);
  if (!subject.ok) return bad(`subject: ${subject.error}`, 422);
  const details = body.details == null || body.details === "" ? null : clampText(body.details, 2000, true);
  if (details && !details.ok) return bad(`details: ${details.error}`, 422);
  const role = typeof body.role === "string" && body.role.trim() ? body.role.trim() : null;
  // With an explicit session the role is only a free-text label (older clients); to route by role it must be a team role.
  if (role && !hasSession && !isRoleId(role)) return bad("role: unknown role", 422);
  if (role && hasSession && !isRoleId(role) && !ROLE_RE.test(role)) return bad("role: up to 32 letters, digits, space, '-' or '_'", 422);
  if (!hasSession && !role) return bad("session or role is required", 422);
  const prio = typeof body.prio === "string" && body.prio ? body.prio.toUpperCase() : null;
  if (prio && !PRIOS.includes(prio)) return bad("prio must be one of P0-P3", 422);
  const sched = parseSchedule(body.schedule);
  if (!sched.ok) return bad(`schedule: ${sched.error}`, 422);

  const { db } = o;
  let session = hasSession ? (body.session as string) : "";
  let started = false;
  const extra = [role && `role: ${role}`, prio && `prio: ${prio}`].filter(Boolean).join(", ");
  const plain = `New task: ${subject.value}${extra ? ` (${extra})` : ""}${details?.ok ? `\n${details.value}` : ""}`;
  // Scheduled: the session books it with its own CronCreate; the task row says when.
  const text = sched.value ? scheduledPrompt(plain, sched.value) : plain;
  const title = sched.value ? `${subject.value} · ⏰ ${scheduleLabel(sched.value)} (nhờ phiên lên lịch)` : subject.value;
  if (!hasSession) {
    const picked = await pickByRole(db, role as string);
    if (picked) session = picked;
    else {
      // A fresh session gets the task as its first prompt: typing into a pane that is still booting loses it.
      const r = await startForRole(db, role as RoleId, body, uiPort(req), text);
      if ("res" in r) return r.res;
      session = r.name;
      started = true;
    }
  }
  // A session started elsewhere gets the task through its inbox (delivered at its next turn end).
  if (inbox) {
    const taskId = `owner:${stamp()}`;
    db.prepare(
      "INSERT INTO tasks(session, task_id, subject, role, prio, status, updated_at) VALUES (?, ?, ?, ?, ?, 'todo', ?)",
    ).run(session, taskId, title, role, prio, stamp());
    const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
    queueInbox(session, text);
    const message = ownerMessage(db, session, text, "inbox");
    return json({ task, session, started: false, message, delivery: "inbox", error: null }, 201);
  }
  // Refuse before the task row exists: nothing is stored while a dialog is open.
  const waiting = started ? null : await openDialog(session, capturePlain);
  if (waiting) return json({ error: "session-waiting", dialog: waiting }, 409);
  const taskId = `owner:${stamp()}`;
  db.prepare(
    "INSERT INTO tasks(session, task_id, subject, role, prio, status, updated_at) VALUES (?, ?, ?, ?, ?, 'todo', ?)",
  ).run(session, taskId, title, role, prio, stamp());
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  if (started) return json({ task, session, started, message: null, delivery: "first-prompt", error: null }, 201);
  let r: Awaited<ReturnType<typeof deliverWatched>>;
  try {
    r = await deliverWatched(db, session, text, {
      sendKeys,
      capture: capturePlain,
    });
  } catch (e) {
    if (!(e instanceof SessionWaiting)) throw e;
    // A dialog opened between the check and delivery: drop the task again.
    db.prepare("DELETE FROM tasks WHERE task_id = ?").run(taskId);
    return json({ error: "session-waiting", dialog: e.dialog }, 409);
  }
  return json({ task, session, started, message: r.message, delivery: r.delivery, error: r.error }, 201);
}

/** The running hq session with this role that was active least recently, or null. */
async function pickByRole(db: DatabaseSync, role: string): Promise<string | null> {
  const live = new Set((await listTmux()).map((t) => t.name));
  const rows = db
    .prepare(
      `SELECT s.name, MAX(s.started_at, COALESCE((SELECT MAX(updated_at) FROM tasks WHERE session = s.name), 0),
         COALESCE((SELECT MAX(ts) FROM messages WHERE session = s.name), 0)) AS activity
       FROM sessions s WHERE s.role = ? ORDER BY activity ASC, s.name ASC`,
    )
    .all(role) as { name: string }[];
  return rows.find((r) => live.has(r.name))?.name ?? null;
}

async function startForRole(db: DatabaseSync, role: RoleId, body: Record<string, unknown>, port?: string, prompt?: string): Promise<{ name: string } | { res: Response }> {
  if (body.model != null && body.model !== "" && !isModelId(body.model)) return { res: bad("model: not an allowed model", 422) };
  const model = isModelId(body.model) ? body.model : roleOf(role)!.model;
  const projectId = Number(body.project);
  const project = Number.isInteger(projectId)
    ? (db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as ProjectRow | undefined)
    : undefined;
  if (!project) return { res: bad("no running session has this role: pick a project to start one", 422) };
  const dir = validateProjectPath(project.path);
  if (!dir.ok) return { res: bad(`project folder: ${dir.error}`, 409) };
  const taken = new Set((await listTmux()).map((t) => t.name));
  let n = 1;
  while (taken.has(`hq-${role}-${n}`)) n++;
  const name = `hq-${role}-${n}`;
  try {
    const r = await startHqSession(db, { name, projectId: project.id, cwd: dir.value, role, model, port, prompt });
    if (!r.ok) return { res: bad(`tmux: ${r.stderr.trim() || "failed to start"}`, 502) };
  } catch (e) {
    return { res: bad((e as Error).message, 500) };
  }
  return { name };
}

function uiPort(req: Request): string | undefined {
  const fromEnv = process.env.PORT || process.env.HQ_UI_PORT;
  if (fromEnv && /^\d{1,5}$/.test(fromEnv)) return fromEnv;
  return /:(\d{1,5})$/.exec(req.headers.get("host") ?? "")?.[1];
}
