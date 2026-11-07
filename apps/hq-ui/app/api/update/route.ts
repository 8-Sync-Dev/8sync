import { bad, json, open, readBody } from "@/lib/server/http";
import { readUpdate, updateStatus, writeUpdate } from "@/lib/server/auto-update";

export const runtime = "nodejs";

const view = () => ({ cfg: readUpdate(), status: updateStatus() });

/** Tự cập nhật: on/off, the installed binary and UI, the latest release, the last `8sync up`. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json(view());
}

/** `{on}`. */
export async function PUT(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  if (!body || typeof body.on !== "boolean") return bad("Cần {on: true|false}", 422);
  writeUpdate({ on: body.on });
  return json(view());
}
