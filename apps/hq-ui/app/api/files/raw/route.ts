import { ARTIFACT_HEADERS, artifactDelivery } from "@/lib/artifact-headers";
import { getDb } from "@/lib/server/db";
import { isFail, filesRoot, filesSigValid, rawFile } from "@/lib/server/files";
import { bad, cookieAccess, open } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { attachment, sendFile } from "@/lib/server/send-file";

export const runtime = "nodejs";

/**
 * `?root=&path=`: one file's bytes from the room's "Thư mục" panel, streamed (`Range:` → 206).
 * Image, video, audio and PDF go out with their type; anything else, or `?download=1`, is an
 * `application/octet-stream` attachment. Every answer carries the artifact sandbox CSP (next.config.ts
 * sets the same for this path).
 *
 * Auth: `x-hq-token`, or the signed URL from GET /api/files/file (`&e=&sig=`, lib/server/files.ts
 * filesSrc) for `<img>`/`<video>`/`<audio>` and "Tải về", which still needs the owner's own login in
 * this browser: a guest gets nothing.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const given = q.get("root") ?? "";
  const rel = q.get("path") ?? "";
  const sig = q.get("sig");
  let db;
  if (sig !== null) {
    if (!filesSigValid(sig, given, rel, Number(q.get("e")))) return bad("link hết hạn, mở lại file này", 401);
    const who = cookieAccess(req.headers);
    if (!who || !("role" in who)) return bad(who && "error" in who ? who.error : "chưa đăng nhập", 401);
    if (who.role !== "owner") return bad("chỉ chủ HQ xem được file", 403);
    db = getDb();
  } else {
    const o = open(req);
    if ("res" in o) return o.res;
    db = o.db;
  }
  const root = filesRoot(given, await knownRoots(db));
  if (isFail(root)) return bad(root.error, root.status);
  const f = rawFile(root, rel);
  if (isFail(f)) return bad(f.error, f.status);
  const download = q.get("download") === "1" || !f.inline;
  const { type, attachment: asFile } = artifactDelivery(f.type, req.headers.get("sec-fetch-dest"), download);
  const headers: Record<string, string> = {
    ...ARTIFACT_HEADERS,
    "content-disposition": asFile ? attachment(f.name) : `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  };
  return sendFile(req, { path: f.path, name: f.name, type: download ? "application/octet-stream" : type, size: f.size }, { download: false, cache: "private, no-cache", headers });
}
