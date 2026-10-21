import os from "node:os";
import { cookieValue, PUB_COOKIE, readPublic, sideOf, viaTunnel } from "@/lib/server/auth";
import { bad, json, open, readBody } from "@/lib/server/http";
import { mergedSessions } from "@/lib/server/proc";
import { SHELL_KEY, clampSize, closeTerm, input, openShell } from "@/lib/server/term";
import { termResponse } from "@/lib/server/term-http";

export const runtime = "nodejs";

/**
 * The owner's shell is a full shell on this machine: only on the PC itself or a proxy that hands HQ a
 * loopback request after its own login (the VPS GitHub gate). Never through the `--public` quick
 * tunnel, whose only lock is a link key.
 */
function refused(req: Request): Response | null {
  const side = sideOf({ host: req.headers.get("host"), cookie: cookieValue(req.headers.get("cookie"), PUB_COOKIE), tunnel: viaTunnel(req.headers) }, readPublic());
  return side === "local" ? null : bad("Shell không mở qua link Cloudflare (--public); dùng HQ trên máy hoặc link VPS có đăng nhập GitHub.", 403);
}

/** `cwd` only when it is a folder HQ already knows (a sidebar project or a session's folder); else home. */
async function folder(db: Parameters<typeof mergedSessions>[0], want: string | null): Promise<string> {
  if (want) {
    const projects = db.prepare("SELECT path FROM projects").all() as { path: string }[];
    if (projects.some((p) => p.path === want)) return want;
    if ((await mergedSessions(db)).some((s) => s.cwd === want)) return want;
  }
  return os.homedir();
}

/** The shell (`8sync ccc term --shell`): a stream, or one poll with `?gen=&since=` (see termResponse). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = refused(req);
  if (no) return no;
  const url = new URL(req.url);
  const size = clampSize(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows")));
  return termResponse(req, SHELL_KEY, openShell(await folder(o.db, url.searchParams.get("cwd")), size));
}

/** `{data}` keys typed in the browser and/or `{cols, rows}`. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = refused(req);
  if (no) return no;
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  return input(SHELL_KEY, body) ? json({ ok: true }) : bad("shell chưa mở", 409);
}

/** End the shell now. */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  closeTerm(SHELL_KEY);
  return json({ ok: true });
}
