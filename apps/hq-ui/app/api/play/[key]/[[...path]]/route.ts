import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { PLAY_HEADERS } from "@/lib/play-headers";
import { getDb } from "@/lib/server/db";
import { KEY_RE, playDir, playKey, playSegments, playSigValid, playType, rememberRoot, resolvePlayFile, rootOfKey } from "@/lib/server/play";
import { projectRoots } from "@/lib/server/project-ops";

export const runtime = "nodejs";

const text = (body: string, status: number) => new Response(body, { status, headers: { ...PLAY_HEADERS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

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
 * `/api/play/<key>/<exp>.<hmac>/<file>`: one file of that project's last play build (`dist/`). The
 * signature segment (lib/server/play.ts playSigValid: this key, ≤ 12 h) is the only lock: no token, no
 * HQ login cookie, no Origin check (a sandboxed page sends `Origin: null`), so the URL itself is the
 * demo link and the build's relative asset URLs carry it. Every answer, errors included, carries
 * PLAY_HEADERS: the page runs in an opaque origin and can never read HQ's page or call its API with
 * HQ's origin. Paths are parsed from the raw URL, segment by segment, and the real file must stay
 * inside `dist/`. `/api/play/<key>/<sig>` goes to `<sig>/index.html` (a relative Location: it works
 * under any proxy prefix).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const [, , , key, sig, ...rest] = url.pathname.split("/");
  if (!key || !KEY_RE.test(key)) return text("not found", 404);
  if (!sig || !playSigValid(sig, key)) return text("Link chơi thử sai hoặc đã hết hạn (sống 12 giờ): mở lại từ HQ (nút Chơi thử) hoặc xin link demo mới.", 401);
  if (rest.length === 0) return new Response(null, { status: 307, headers: { ...PLAY_HEADERS, location: `${sig}/index.html`, "cache-control": "no-store" } });
  const segments = playSegments(rest.join("/"));
  const root = segments && (await rootFor(key));
  if (!segments || !root) return text("not found", 404);
  const file = resolvePlayFile(path.join(playDir(key), "dist"), segments);
  if (!file) return text("not found", 404);
  const html = file.abs.toLowerCase().endsWith(".html");
  const etag = `"${file.size.toString(16)}-${Math.round(file.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    ...PLAY_HEADERS,
    "content-type": playType(file.abs),
    // A rebuild rewrites dist/ in place: the page is never cached, every other file is revalidated.
    "cache-control": html ? "no-store" : "no-cache",
    etag,
  };
  if (!html && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  if (req.method === "HEAD") return new Response(null, { headers: { ...headers, "content-length": String(file.size) } });
  const stream = Readable.toWeb(fs.createReadStream(file.abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: { ...headers, "content-length": String(file.size) } });
}

export const HEAD = GET;
