import { bad, json, open, readBody } from "@/lib/server/http";
import { playStatus, startPlayBuild } from "@/lib/server/play";
import { projectRoots } from "@/lib/server/project-ops";
import { groupKey } from "@/lib/sidebar";

export const runtime = "nodejs";

/** A root HQ knows (rooms it has seen, folders added in the sidebar), never a path taken on trust. */
async function knownRoot(db: Parameters<typeof projectRoots>[0], root: unknown): Promise<string | Response> {
  if (typeof root !== "string" || !root || root.length > 4096) return bad("cần root", 422);
  const known = (await projectRoots(db)).roots.get(groupKey(root));
  return known ?? bad("dự án này không có trong HQ", 409);
}

/** `?root=` (+ `fresh=1`: `git fetch origin main` first, at most every 30 s): what "Chơi thử" can show. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const root = await knownRoot(o.db, url.searchParams.get("root"));
  if (root instanceof Response) return root;
  return json({ status: await playStatus(root, { fresh: url.searchParams.get("fresh") === "1" }) });
}

/** `{root}`: build origin/main of that project in its play worktree. 409 while one already runs. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = await knownRoot(o.db, body?.root);
  if (root instanceof Response) return root;
  const r = startPlayBuild(root);
  if (!r.ok) return bad(r.error, 409);
  return json({ status: await playStatus(root) }, 202);
}
