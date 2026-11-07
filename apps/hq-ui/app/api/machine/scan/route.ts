import { bad, json, open } from "@/lib/server/http";
import { scanNow } from "@/lib/server/machine-watch";

export const runtime = "nodejs";

/** `8sync ccc eco scan --json` (nothing touched); `?fresh=1` scans again, else a scan under 20 s old is reused. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const s = await scanNow(fresh ? 0 : 20_000);
  return s ? json(s) : bad("8sync ccc eco scan không chạy được (8sync cũ? chạy 8sync up)", 502);
}
