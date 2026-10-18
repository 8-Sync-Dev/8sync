import { bad, json, open } from "@/lib/server/http";
import { saveUpload, UPLOAD_MAX } from "@/lib/server/uploads";

export const runtime = "nodejs";

/** base64 of the largest file plus room for the name. */
const BODY_MAX = Math.ceil((UPLOAD_MAX * 4) / 3) + 4096;

/**
 * {name, data}: stage one attachment (data = base64) for the composer; returns {id, name, size}.
 * Nothing reaches a repo until POST /api/targets names the id (lib/server/uploads.ts).
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > BODY_MAX) return bad(`file quá ${UPLOAD_MAX / 1024 / 1024} MB`, 413);
  const raw = await req.text();
  if (raw.length > BODY_MAX) return bad(`file quá ${UPLOAD_MAX / 1024 / 1024} MB`, 413);
  let b: { name?: unknown; data?: unknown };
  try {
    b = JSON.parse(raw);
  } catch {
    return bad("body must be JSON {name, data}", 400);
  }
  if (typeof b?.name !== "string" || !b.name.trim() || b.name.length > 255) return bad("name must be a file name", 422);
  if (typeof b.data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.data)) return bad("data must be base64", 422);
  try {
    return json(saveUpload(b.name, Buffer.from(b.data, "base64")));
  } catch (e) {
    return bad((e as Error).message, 422);
  }
}
