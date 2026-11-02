import { cookieValue, PUB_COOKIE, readPublic, sideOf, viaTunnel } from "@/lib/server/auth";
import { bad, json, open, readBody } from "@/lib/server/http";
import { restartApp, restartPid } from "@/lib/server/machine";

export const runtime = "nodejs";

/**
 * `{rootPid}`: close and reopen the app whose renderer holds ≥ 4 GB (`8sync ccc eco restart`, which
 * refuses anything but a heavy, restartable app's main process right now). It closes the owner's
 * apps on this PC: like /api/shell, only on the PC itself or behind the VPS GitHub gate, never
 * through the `--public` quick tunnel.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const side = sideOf({ host: req.headers.get("host"), cookie: cookieValue(req.headers.get("cookie"), PUB_COOKIE), tunnel: viaTunnel(req.headers) }, readPublic());
  if (side !== "local") return bad("Khởi động lại app không chạy qua link Cloudflare (--public); dùng HQ trên máy hoặc link VPS có đăng nhập GitHub.", 403);
  const pid = restartPid(await readBody(req));
  if (pid == null) return bad("rootPid phải là số nguyên dương", 422);
  const r = await restartApp(pid);
  return r.ok ? json(r.v) : bad(r.error, 409);
}
