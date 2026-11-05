import fs from "node:fs";
import { checkRelFile, parseSkeleton } from "@/lib/codemap";
import { bad, json, open } from "@/lib/server/http";
import { indexStatus, insideRoot, projectFor, skeletonArgs, trailJson, trailRead } from "@/lib/server/trail";

export const runtime = "nodejs";

/** `?file=<repo-relative>`: `trail skeleton` of a file inside a registered project (checked on disk, symlinks followed). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const url = new URL(req.url);
  const f = checkRelFile(url.searchParams.get("file"));
  if (!f.ok) return bad(f.error, 422);
  const p = projectFor(o.db, url.searchParams.get("project"));
  if (!p.ok) return bad(p.error, p.status);
  const at = insideRoot(p.project.root, f.value);
  if (!at || !isFile(at)) return bad("không có file này trong dự án", 404);
  if (!indexStatus(p.project.root).indexed) return bad("dự án chưa có code map: bấm Index ngay", 409);
  const r = trailJson(await trailRead(p.project.root, skeletonArgs(f.value, p.project.root)), parseSkeleton);
  return r.ok ? json({ skeleton: r.value }) : bad(r.error, r.status);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
