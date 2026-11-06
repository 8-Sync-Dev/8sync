import { bad, json, open, readBody } from "@/lib/server/http";
import { run } from "@/lib/server/proc";
import { makeFolder, treeListing } from "@/lib/server/tree";

export const runtime = "nodejs";

/** ?path=<absolute folder> (empty = the machine's roots): its sub-folders, for the workspace's folder tree (lib/server/tree.ts). */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const listing = treeListing(new URL(req.url).searchParams.get("path") ?? "");
  return listing ? json(listing) : bad("không phải thư mục", 404);
}

/**
 * {parent, name, git?}: a new empty project folder `name` inside `parent` (the folder picker's "Thư mục mới").
 * `git: true` runs `git init` in it; a failed init keeps the folder and says so (`git` false + `gitError`).
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const body = await readBody(req);
  const parent = typeof body?.parent === "string" ? body.parent : "";
  const name = typeof body?.name === "string" ? body.name : "";
  if (!parent || (body?.git !== undefined && typeof body.git !== "boolean")) return bad("cần {parent, name, git?: boolean}", 422);
  const made = makeFolder(parent, name);
  if (!made.ok) return bad(made.error, made.status);
  if (!body?.git) return json({ path: made.path, git: false }, 201);
  const init = await run("git", ["init"], 15_000, made.path);
  return json({ path: made.path, git: init.ok, ...(init.ok ? {} : { gitError: (init.stderr || "git init lỗi").trim().slice(0, 300) }) }, 201);
}
