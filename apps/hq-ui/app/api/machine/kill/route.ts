import { cookieValue, PUB_COOKIE, readPublic, sideOf, viaTunnel } from "@/lib/server/auth";
import { bad, json, open, readBody } from "@/lib/server/http";
import { KILL_ID_RE, killIds } from "@/lib/server/machine-watch";

export const runtime = "nodejs";

/**
 * `{ids: ["pid:start", …], tree?: boolean}` → `8sync ccc eco kill`, which re-reads the processes and
 * kills only an exact pid + start that is not a session, Claude, HQ, 8sync or the OS. It kills the
 * owner's processes: like restart, never through the `--public` quick tunnel.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const side = sideOf({ host: req.headers.get("host"), cookie: cookieValue(req.headers.get("cookie"), PUB_COOKIE), tunnel: viaTunnel(req.headers) }, readPublic());
  if (side !== "local") return bad("Kill không chạy qua link Cloudflare (--public); dùng HQ trên máy hoặc link VPS có đăng nhập GitHub.", 403);
  const body = await readBody(req);
  const ids = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length || ids.length > 30 || !ids.every((x): x is string => typeof x === "string" && KILL_ID_RE.test(x))) return bad("ids: 1–30 mục dạng pid:start", 422);
  const rows = await killIds(ids, body?.tree === true);
  return rows ? json({ results: rows }) : bad("8sync ccc eco kill không chạy được (8sync cũ? chạy 8sync up)", 502);
}
