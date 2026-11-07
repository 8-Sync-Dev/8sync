import { json, open } from "@/lib/server/http";
import { allTemplates } from "@/lib/server/templates";

export const runtime = "nodejs";

/** Bot templates for "Bot mới": `{templates}`, built-in ones (`builtIn: true`) with the owner's ~/.config/8sync/hq/templates/*.json on top. */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  return json({ templates: allTemplates() });
}
