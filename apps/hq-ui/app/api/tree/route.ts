import { bad, json, open } from "@/lib/server/http";
import { treeListing } from "@/lib/server/tree";

export const runtime = "nodejs";

/** ?path=<absolute folder> (empty = the machine's roots): its sub-folders, for the workspace's folder tree (lib/server/tree.ts). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const listing = treeListing(new URL(req.url).searchParams.get("path") ?? "");
  return listing ? json(listing) : bad("không phải thư mục", 404);
}
