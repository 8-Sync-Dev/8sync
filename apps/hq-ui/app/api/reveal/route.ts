import { bad, json, localOnly, open, readBody } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { reveal, revealTarget } from "@/lib/server/reveal";

export const runtime = "nodejs";

/**
 * `{id}` (an artifact) or `{path, base?}` (a file a result names; relative to `base`, the room's folder):
 * show it in this machine's file manager. Only from this machine's side (the `--public` link sees the
 * path and copies it, nothing opens on a desk nobody sits at), only the owner, and only a file inside a
 * project HQ knows (lib/server/reveal.ts).
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const no = localOnly(req, "Chỉ mở thư mục từ HQ trên máy chủ (không qua link --public).");
  if (no) return no;
  const b = await readBody(req);
  if (!b) return bad("body must be a JSON object", 422);
  const t = revealTarget(o.db, b, await knownRoots(o.db));
  if (!t.ok) return bad(t.error, t.status);
  if (!(await reveal(t.target, t.dir))) return bad("không mở được trình quản lý file trên máy này", 500);
  return json({ ok: true });
}
