import { loopState, setLoopProject } from "@/lib/server/cleanup-loop";
import { bad, json, open, readBody } from "@/lib/server/http";

export const runtime = "nodejs";

/** The cleanup loop: which projects have it on, their room, last run, next run, last send. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(loopState());
}

/** `{root, on?: boolean, room?: string | null}`: flip one project's loop or pick its room. */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const b = await readBody(req);
  const root = b?.root;
  if (typeof root !== "string" || !root.trim() || root.length > 1024) return bad("root: thư mục dự án");
  if (b!.on !== undefined && typeof b!.on !== "boolean") return bad("on: true hoặc false");
  if (b!.room !== undefined && b!.room !== null && (typeof b!.room !== "string" || b!.room.length > 200)) return bad("room: tên phòng hoặc null");
  if (b!.on === undefined && b!.room === undefined) return bad("cần on hoặc room");
  try {
    return json(setLoopProject(root, { on: b!.on as boolean | undefined, room: b!.room as string | null | undefined }));
  } catch (e) {
    return bad(`không lưu được cleanup.json: ${(e as Error).message}`, 503);
  }
}
