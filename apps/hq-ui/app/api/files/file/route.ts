import { FILES_EDIT_MAX } from "@/lib/files";
import { bad, json, open } from "@/lib/server/http";
import { isFail, filesRoot, readFileView, saveText } from "@/lib/server/files";
import { knownRoots } from "@/lib/server/in-view";

export const runtime = "nodejs";

/**
 * `?root=&path=`: one file for the viewer (lib/files.ts FileView): text kinds up to 2 MB with `text` and
 * the `hash` a save sends back, every kind with `src`, a signed URL to its bytes. Owner only.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  const given = q.get("root") ?? "";
  const root = filesRoot(given, await knownRoots(o.db));
  if (isFail(root)) return bad(root.error, root.status);
  const view = readFileView(root, given, q.get("path") ?? "");
  return isFail(view) ? bad(view.error, view.status) : json(view);
}

/** JSON-escaped text may run longer than its bytes: the body cap leaves room for that. */
const BODY_MAX = 8 * FILES_EDIT_MAX;

/**
 * `{root, path, text, hash}`: rewrite an existing text file (≤ 1 MB) when it still hashes to `hash`;
 * 409 "file vừa đổi trên máy, tải lại" when it changed since it was loaded. Never creates a file.
 */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return bad("nội dung quá lớn", 413);
  const raw = await req.text();
  if (raw.length > BODY_MAX) return bad("nội dung quá lớn", 413);
  let b: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return bad("body must be a JSON object", 422);
    b = v as Record<string, unknown>;
  } catch {
    return bad("body must be a JSON object", 422);
  }
  if (typeof b.root !== "string" || typeof b.path !== "string" || !b.path) return bad("root, path: thư mục dự án và file trong đó", 422);
  const root = filesRoot(b.root, await knownRoots(o.db));
  if (isFail(root)) return bad(root.error, root.status);
  const saved = saveText(root, b.path, b.text, b.hash);
  return isFail(saved) ? bad(saved.error, saved.status) : json(saved);
}
