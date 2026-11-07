import path from "node:path";
import { FILES_LOCATE_MAX, FILES_REF_MAX, type FileSpots } from "@/lib/files";
import { locateFile } from "@/lib/server/files";
import { bad, json, open, readBody } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { projectOf } from "@/lib/server/office";

export const runtime = "nodejs";

/**
 * `{base, paths}`: where each file a room's reply names is (lib/server/files.ts locateFile), so its chip
 * shows the file's type, or why it cannot open, and a tap opens it in the viewer. A relative path or a
 * bare name is looked up under `base` (the room's folder), then under that folder's repo root. Only files
 * inside a project HQ knows (rooms that ended included) and not secrets are found. Owner only.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const b = await readBody(req);
  if (!b) return bad("body must be a JSON object", 422);
  const { paths, base } = b;
  if (!Array.isArray(paths) || !paths.length || paths.length > FILES_LOCATE_MAX || !paths.every((p) => typeof p === "string" && p.length > 0 && p.length <= FILES_REF_MAX)) {
    return bad(`paths: 1–${FILES_LOCATE_MAX} đường dẫn file`, 422);
  }
  // A UNC base (`\\host\x`) is refused before anything stats it: Windows would dial out to that host.
  if (base !== undefined && base !== null && (typeof base !== "string" || base.length > FILES_REF_MAX || !path.isAbsolute(base) || /^[\\/]{2}/.test(base))) {
    return bad("base: thư mục tuyệt đối của phòng", 422);
  }
  const bases = typeof base === "string" ? [base, projectOf(base)?.root ?? base] : [];
  const known = await knownRoots(o.db, { ended: true });
  const out: FileSpots = { files: (paths as string[]).map((p) => locateFile(p, bases, known)) };
  return json(out);
}
