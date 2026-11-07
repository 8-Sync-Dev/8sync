import { json, open } from "@/lib/server/http";
import { readUpdate, updateNow } from "@/lib/server/auto-update";

export const runtime = "nodejs";

/** "Kiểm ngay": check the latest release now and run `8sync up` when it is newer (also while off). */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ cfg: readUpdate(), status: await updateNow(true) });
}
