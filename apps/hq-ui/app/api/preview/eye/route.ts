import { setEye } from "@/lib/server/eye";
import { bad, json, open, readBody } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { previewRoots } from "@/lib/server/preview";
import { mergedSessions } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

/** {root, on}: "Tự soi ảnh" for one project the Preview tab shows; only the `eye` room starts or stops. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (typeof body?.root !== "string" || !body.root || typeof body.on !== "boolean") return bad("cần {root, on: true|false}", 422);
  const want = body.root.toLowerCase();
  const root = previewRoots(liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd))).find((x) => x.root.toLowerCase() === want)?.root;
  if (!root) return bad("dự án này không có phòng nào đang chạy", 409);
  const r = await setEye(o.db, root, body.on);
  return json(r, r.ok ? 200 : 502);
}
