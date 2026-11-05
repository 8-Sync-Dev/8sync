import fs from "node:fs";
import { bad, open } from "@/lib/server/http";
import { graphInfo, projectFor } from "@/lib/server/trail";

export const runtime = "nodejs";

/**
 * A registered project's `graphify-out/graph.html`, as text: the tab puts it in a sandboxed srcdoc
 * frame (scripts, no same-origin). Sent as text/plain under a sandbox CSP so opening the URL itself
 * never runs it as HQ.
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const p = projectFor(o.db, new URL(req.url).searchParams.get("project"));
  if (!p.ok) return bad(p.error, p.status);
  const g = graphInfo(p.project.root);
  if (!g.html) return bad(g.dir ? "graphify-out/ chưa có graph.html" : "dự án chưa có graphify-out/", 404);
  let body: Buffer;
  try {
    body = fs.readFileSync(g.html.file);
  } catch {
    return bad("không đọc được graph.html", 500);
  }
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-security-policy": "sandbox; default-src 'none'",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
