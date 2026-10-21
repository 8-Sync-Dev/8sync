import { bad, json, open, readBody } from "@/lib/server/http";
import { readPins } from "@/lib/server/office";
import { projectRoots } from "@/lib/server/project-ops";
import { run } from "@/lib/server/proc";
import { groupKey } from "@/lib/sidebar";

export const runtime = "nodejs";

/**
 * {root, pinned: true | false}: the sidebar's pin button → `8sync ccc auto pin|unpin <root>` (owner
 * only in 8sync; HQ's children carry no room env). Pin: a project HQ knows (a live room or an added
 * folder, rooms or not). Unpin: also a pinned root HQ no longer knows. Answers the fresh pin list.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const root = typeof body?.root === "string" ? body.root : "";
  if (!root || root.length > 4096 || typeof body?.pinned !== "boolean") return bad("cần {root, pinned: true | false}", 422);
  const key = groupKey(root);
  const known = (await projectRoots(o.db)).roots.get(key) ?? (body.pinned ? undefined : readPins().find((p) => groupKey(p.root) === key)?.root);
  if (!known) return bad("dự án này không có trong HQ", 409);
  const r = await run("8sync", ["ccc", "auto", body.pinned ? "pin" : "unpin", known, "--json"], 10_000);
  if (!r.ok) return json({ error: (r.stderr.trim() || "8sync ccc auto pin thất bại").slice(0, 200) }, 502);
  return json({ ok: true, pins: readPins() });
}
