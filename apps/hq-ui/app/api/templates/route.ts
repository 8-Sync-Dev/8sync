import { bad, json, open, readBody } from "@/lib/server/http";
import { senderOf } from "@/lib/server/sender";
import { allTemplates, createTemplate, deleteTemplate, updateTemplate } from "@/lib/server/templates";

export const runtime = "nodejs";

/** Bot templates for "Bot mới": `{templates}`, built-in ones (`builtIn: true`) with the owner's ~/.config/8sync/hq/templates/*.json on top. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ templates: allTemplates() });
}

const OWNER_ONLY = "Chỉ chủ HQ sửa mẫu, từ trang HQ";

/** The owner's page only (403 for a room's hq.mjs). */
function owner(req: Request): { res: Response } | null {
  const o = open(req);
  if ("res" in o) return o;
  return senderOf(req, o.access).by === "owner" ? null : { res: bad(OWNER_ONLY, 403) };
}

/** `{template}` → a new `<id>.json` (a taken id gets `-2`…). 201 `{template}`; 422 a wrong field; 409 at 100 files. */
export async function POST(req: Request) {
  const no = owner(req);
  if (no) return no.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const r = createTemplate(body.template);
  return r.ok ? json({ template: r.template }, 201) : bad(r.error, r.status);
}

/** `{template}` replaces the owner's template with its id. 200 `{template}`; 404 none (a built-in); 422 a wrong field. */
export async function PUT(req: Request) {
  const no = owner(req);
  if (no) return no.res;
  const body = await readBody(req);
  if (!body) return bad("JSON body required");
  const t = body.template;
  const id = t && typeof t === "object" && "id" in t && typeof t.id === "string" ? t.id : null;
  if (!id) return bad("template.id required", 422);
  const r = updateTemplate(id, t);
  return r.ok ? json({ template: r.template }) : bad(r.error, r.status);
}

/** `?id=` deletes the owner's template file. 200 `{deleted}`; 404 none. */
export async function DELETE(req: Request) {
  const no = owner(req);
  if (no) return no.res;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required", 422);
  return deleteTemplate(id) ? json({ deleted: id }) : bad("Không có mẫu riêng này.", 404);
}
