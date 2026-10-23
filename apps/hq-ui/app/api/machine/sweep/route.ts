import { diskKey } from "@/lib/disk";
import { autoStatus, lastAutoStatus } from "@/lib/server/auto";
import { bad, json, open, readBody } from "@/lib/server/http";
import { runningTeams, setSweep } from "@/lib/server/sweep";
import { SWEEP_OMP_ONLY, sweepAllowed } from "@/lib/sweep";

export const runtime = "nodejs";

/** {root, on}: "Dọn máy tự động" for one running team (Máy tab, "Bảo vệ máy"); only its `sweep` room starts or stops. An omp-only team cannot turn it on (it may still stop a leftover sweep). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (typeof body?.root !== "string" || !body.root || typeof body.on !== "boolean") return bad("cần {root, on: true|false}", 422);
  const want = diskKey(body.root);
  const st = lastAutoStatus() ?? (await autoStatus());
  const root = runningTeams(st).find((r) => diskKey(r) === want);
  if (!root) return bad("team của dự án này chưa chạy", 409);
  if (body.on && !sweepAllowed(st.teams, st.engines, root)) return bad(SWEEP_OMP_ONLY, 409);
  const r = await setSweep(o.db, root, body.on);
  return json(r, r.ok ? 200 : 502);
}
