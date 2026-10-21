import { autoStatus } from "@/lib/server/auto";
import { guardArgv, setGuard } from "@/lib/server/guard";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/** Exactly one of `{pct: 30..95 | null}` (RAM threshold, null = guard off), `{cpu: 30..95}` (CPU threshold), `{cap: 10..90 | null}` or `{eco: boolean}`: the Máy tab "Bảo vệ máy" card, `8sync ccc auto guard <pct>|off|cpu <n>|cap <n>|off|eco on|off`. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const argv = guardArgv(body);
  if (!argv) return bad("pct: số nguyên 30..95 hoặc null (tắt), cpu: số nguyên 30..95, cap: số nguyên 10..90 hoặc null (tắt), hoặc eco: true/false — đúng một trong bốn");
  const r = await setGuard(argv);
  if (!r.ok) return bad(r.message, 409);
  // Refresh the shared status so the next /api/machine poll shows the new threshold.
  await autoStatus();
  return json({ ok: true, message: r.message });
}
