import { bad, json, open } from "@/lib/server/http";
import { listDir, resolveDir } from "@/lib/server/fs-list";

export const runtime = "nodejs";

/** ?base=<absolute dir>&path=<relative, may start with ../>: the folder's entries for the "@" picker. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const base = url.searchParams.get("base") ?? "";
  const rel = url.searchParams.get("path") ?? "";
  const dir = resolveDir(base, rel);
  if (!dir) return bad("không phải thư mục", 404);
  return json({ dir: dir.replace(/\\/g, "/"), entries: listDir(dir) });
}
