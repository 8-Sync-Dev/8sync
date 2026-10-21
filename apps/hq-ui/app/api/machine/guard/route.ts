import { autoStatus } from "@/lib/server/auto";
import { guardArgv, setGuard } from "@/lib/server/guard";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/** `{pct: 30..95 | null}` (null = off) or `{eco: boolean}`, exactly one: the Máy tab "Bảo vệ máy" card, `8sync ccc auto guard <pct>|off|eco on|off`. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const argv = guardArgv(body);
  if (!argv) return bad("pct: số nguyên 30..95 hoặc null (tắt), hoặc eco: true/false — đúng một trong hai");
  const r = await setGuard(argv);
  if (!r.ok) return bad(r.message, 409);
  // Refresh the shared status so the next /api/machine poll shows the new threshold.
  await autoStatus();
  return json({ ok: true, message: r.message });
}
