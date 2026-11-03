import os from "node:os";
import { cookieValue, PUB_COOKIE, readPublic, sideOf, viaTunnel } from "@/lib/server/auth";
import { bad, json, open, readBody } from "@/lib/server/http";
import { existingDir } from "@/lib/server/omp-sessions";
import { clampSize, closeTerm, input, openShell, shellKey } from "@/lib/server/term";
import { polledEnded, termResponse } from "@/lib/server/term-http";

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

/**
 * `cwd` when it is an existing absolute folder, else home. Any folder: this route only answers on this
 * machine's side (see `refused`) and the shell can `cd` anywhere anyway; the old "known folders only"
 * check missed omp sessions (Không gian), so their shell landed in home.
 */
function folder(req: Request): string {
  return existingDir(new URL(req.url).searchParams.get("cwd")) ?? os.homedir();
}

/** The shell of `?cwd=` (`8sync ccc term --shell`): a stream, or one poll with `?gen=&since=` (see termResponse). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = refused(req);
  if (no) return no;
  const url = new URL(req.url);
  const size = clampSize(Number(url.searchParams.get("cols")), Number(url.searchParams.get("rows")));
  const cwd = folder(req);
  const gone = polledEnded(req, shellKey(cwd));
  return termResponse(req, shellKey(cwd), gone ?? openShell(cwd, size));
}

/** `{data}` keys typed in the browser and/or `{cols, rows}`, for the shell of `?cwd=`. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = refused(req);
  if (no) return no;
  const body = await readBody(req);
  if (!body) return bad("body must be a JSON object", 422);
  return input(shellKey(folder(req)), body) ? json({ ok: true }) : bad("shell chưa mở", 409);
}

/** End the shell of `?cwd=` now. */
export async function DELETE(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  closeTerm(shellKey(folder(req)));
  return json({ ok: true });
}
