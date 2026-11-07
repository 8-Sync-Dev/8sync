import { deniedText } from "@/lib/access";
import { checkRoot, checkSymbol, explainArgs, graphifyAsk, graphifyCommand, pathArgs, startUpdate, updateState } from "@/lib/server/graphify";
import { bad, json, open, readBody } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { projectFor } from "@/lib/server/trail";

export const runtime = "nodejs";

/** `?project=`: whether graphify is installed and the project's last `graphify update` (in memory). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = projectFor(o.db, new URL(req.url).searchParams.get("project"));
  if (!p.ok) return bad(p.error, p.status);
  return json({ installed: graphifyCommand() != null, update: updateState(p.project.root) });
}

/**
 * `{ project, action: "update" }` starts `graphify update . --no-cluster` (202, progress on GET);
 * `{ project, action: "explain", symbol }` / `{ project, action: "path", a, b }` answer with its text.
 * Owner only; `open` checks token and origin; the root is the project's own, and must be one HQ knows.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (o.access.role !== "owner") return bad(deniedText(o.access.role), 403);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const p = projectFor(o.db, body.project);
  if (!p.ok) return bad(p.error, p.status);
  const no = checkRoot(p.project.root, await knownRoots(o.db));
  if (no) return bad(no.error, no.status);
  if (body.action === "update") {
    const u = startUpdate(p.project);
    return "status" in u ? bad(u.error, u.status) : json({ update: u }, 202);
  }
  let args: string[];
  if (body.action === "explain") {
    const x = checkSymbol(body.symbol);
    if (!x.ok) return bad(x.error, 422);
    args = explainArgs(x.value);
  } else if (body.action === "path") {
    const a = checkSymbol(body.a, "điểm đầu");
    if (!a.ok) return bad(a.error, 422);
    const b = checkSymbol(body.b, "điểm cuối");
    if (!b.ok) return bad(b.error, 422);
    args = pathArgs(a.value, b.value);
  } else return bad("action: update | explain | path", 422);
  const r = await graphifyAsk(p.project.root, args);
  return r.ok ? json({ text: r.text }) : bad(r.error, r.status);
}
