import { parseKnow } from "@/lib/know";
import { bad, json, open } from "@/lib/server/http";
import { projectOf } from "@/lib/server/office";
import { mergedSessions, run } from "@/lib/server/proc";
import { liveProjects } from "@/lib/server/targets";

export const runtime = "nodejs";

const TIMEOUT_MS = 6000;

/**
 * `8sync ccc know ls --json --all` run in the project at `?root=` (a project with a live room, so the
 * path never comes from the browser alone): the machine's knowledge tree, that project's book first.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const want = (new URL(req.url).searchParams.get("root") ?? "").toLowerCase();
  if (!want || want.length > 1024) return bad("root: cần đường dẫn dự án", 422);
  const root = liveProjects(await mergedSessions(o.db), (cwd) => projectOf(cwd)).find((x) => x.root.toLowerCase() === want)?.root;
  if (!root) return bad("dự án này không có phòng nào đang chạy", 409);
  const r = await run("8sync", ["ccc", "know", "ls", "--json", "--all"], TIMEOUT_MS, root);
  if (!r.ok) return json({ shared: null, own: null, others: [], dir: null, error: (r.stderr.trim() || "8sync ccc know không chạy được (8sync < 0.110.41?)").slice(0, 200) });
  try {
    return json(parseKnow(JSON.parse(r.stdout)));
  } catch {
    return json({ shared: null, own: null, others: [], dir: null, error: "8sync ccc know ls trả JSON không hợp lệ" });
  }
}
