import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";
import { AI_TEXT_MAX, generateTemplate } from "@/lib/server/template-ai";
import { checkTemplate } from "@/lib/templates";

export const runtime = "nodejs";

/**
 * The owner's page only (403 for a room). `{mode:"new", text}` writes a template from one sentence;
 * `{mode:"rewrite", text, template}` rewrites `template` as `text` asks (its id kept). 200 `{template}`,
 * a draft that is NOT saved; 422 bad input; 502 an answer that is not a valid template; 504 past 60 s.
 */
export async function POST(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  if (senderOf(req, o.access).by !== "owner") return bad("Chỉ chủ HQ dùng AI viết mẫu, từ trang HQ", 403);
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > AI_TEXT_MAX || /[\0-\x09\x0b-\x1f\x7f]/.test(text)) return bad(`Mô tả: 1 đến ${AI_TEXT_MAX} ký tự.`, 422);
  if (body.mode === "new") {
    const r = await generateTemplate({ mode: "new", text });
    return r.ok ? json({ template: r.template }) : bad(r.error, r.status);
  }
  if (body.mode === "rewrite") {
    const cur = checkTemplate(body.template);
    if (!cur.ok) return bad(`Mẫu hiện tại chưa hợp lệ: ${cur.error}`, 422);
    const r = await generateTemplate({ mode: "rewrite", text, template: cur.template });
    return r.ok ? json({ template: r.template }) : bad(r.error, r.status);
  }
  return bad("mode: new hoặc rewrite", 422);
}
