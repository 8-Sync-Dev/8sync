import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { getDb } from "@/lib/server/db";
import { KEY_RE, playAllowed, playCookie, playDir, playKey, playSegments, playType, rememberRoot, resolvePlayFile, rootOfKey, viaHttps } from "@/lib/server/play";
import { projectRoots } from "@/lib/server/project-ops";

export const runtime = "nodejs";

const text = (body: string, status: number) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/** The key's project root: remembered from a status call, else looked up once among the roots HQ knows. */
async function rootFor(key: string): Promise<string | null> {
  const hit = rootOfKey(key);
  if (hit) return hit;
  for (const root of (await projectRoots(getDb())).roots.values()) {
    if (playKey(root) !== key) continue;
    rememberRoot(root);
    return root;
  }
  return null;
}

/**
 * `/api/play/<key>/<file>`: one file of that project's last play build (`dist/`). Same Host rule as
 * the rest of HQ plus a signature for THIS key: the `hq_play` cookie (path-scoped to `/api/play/<key>/`)
 * or a demo link's `?k=` (lib/server/play.ts playAllowed). A valid `k` is answered with the file itself
 * plus the cookie, so the page's assets then pass by cookie. Paths are parsed from the raw URL, segment
 * by segment, and the real file must stay inside `dist/`. `/api/play/<key>` (outside the cookie's path)
 * goes to `<key>/index.html` with its query (a relative Location: it works under any proxy prefix), so
 * the build's relative asset URLs resolve under the key.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const [, , , key, ...rest] = url.pathname.split("/");
  if (!key || !KEY_RE.test(key)) return text("not found", 404);
  if (rest.length === 0) return new Response(null, { status: 307, headers: { location: `${key}/index.html${url.search}`, "cache-control": "no-store" } });
  const k = url.searchParams.get("k");
  const byCookie = playAllowed(req.headers, key);
  const byLink = !byCookie && !!k && playAllowed(req.headers, key, undefined, k);
  if (!byCookie && !byLink) return text("Mở bản chơi thử từ HQ (nút Chơi thử), hoặc xin link demo mới (link sống 12 giờ).", 401);
  const segments = playSegments(rest.join("/"));
  const root = segments && (await rootFor(key));
  if (!segments || !root) return text("not found", 404);
  const file = resolvePlayFile(path.join(playDir(key), "dist"), segments);
  if (!file) return text("not found", 404);
  const html = file.abs.toLowerCase().endsWith(".html");
  const etag = `"${file.size.toString(16)}-${Math.round(file.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    "content-type": playType(file.abs),
    // A rebuild rewrites dist/ in place: the page is never cached, every other file is revalidated.
    "cache-control": html ? "no-store" : "private, no-cache",
    etag,
    "x-content-type-options": "nosniff",
    ...(byLink ? { "set-cookie": playCookie(key, viaHttps(req.headers)) } : {}),
  };
  if (!html && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  const stream = Readable.toWeb(fs.createReadStream(file.abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: { ...headers, "content-length": String(file.size) } });
}
