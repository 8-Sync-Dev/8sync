import { diskProjects, diskState, startScan } from "@/lib/server/disk";
import { json, open } from "@/lib/server/http";

export const runtime = "nodejs";

/** Sizes of every HQ project with what looks abnormal; a result over 6 h old starts a scan in the background. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const projects = await diskProjects(o.db);
  const st = diskState(projects);
  if (st.stale && !st.scanning) void startScan(projects);
  return json({ projects: st.projects, at: st.at, scanning: st.stale || st.scanning });
}

/** "Đo lại": scan now (in the background; poll GET until `scanning` is false). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  void startScan(await diskProjects(o.db));
  return json({ scanning: true }, 202);
}
