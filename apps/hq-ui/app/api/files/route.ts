import { bad, json, open } from "@/lib/server/http";
import { isFail, filesRoot, listFolder } from "@/lib/server/files";
import { knownRoots } from "@/lib/server/in-view";

export const runtime = "nodejs";

/**
 * `?root=<project folder>&path=<folder relative to it, "" = root>`: that folder's entries for the room's
 * "Thư mục" panel, folders first (lib/server/files.ts listFolder). Owner only.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  const root = filesRoot(q.get("root") ?? "", await knownRoots(o.db, { ended: true }));
  if (isFail(root)) return bad(root.error, root.status);
  const listing = listFolder(root, q.get("path") ?? "");
  return isFail(listing) ? bad(listing.error, listing.status) : json(listing);
}
