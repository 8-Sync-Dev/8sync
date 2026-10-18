import { bad, json, open, readBody } from "@/lib/server/http";
import { clean } from "@/lib/server/machine";

export const runtime = "nodejs";

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

/** `8sync clean` (or `--dry-run`): the safe reclaim, Linux only. Returns its report as plain text. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (process.platform !== "linux") return bad("`8sync clean` chỉ chạy trên Linux", 422);
  const body = await readBody(req);
  const out = await clean(body?.dryRun === true);
  if (out == null) return bad("`8sync clean` không chạy được", 502);
  return json({ ok: true, report: out.replace(ANSI, "").slice(-8000) });
}
