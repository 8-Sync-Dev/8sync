import { ARTIFACT_HEADERS } from "@/lib/artifact-headers";
import { bad, open } from "@/lib/server/http";
import { isArtifactId, resolveArtifact } from "@/lib/server/artifacts";
import { findSoffice, officePdf } from "@/lib/server/office-pdf";
import { sendFile } from "@/lib/server/send-file";
import fs from "node:fs";

export const runtime = "nodejs";

/**
 * An Office artifact as PDF, made by LibreOffice on this machine (lib/server/office-pdf.ts) and cached.
 * 501 when LibreOffice is not installed (the view then reads docx/xlsx/pptx/OpenDocument itself),
 * 422 for an artifact that is not an Office file, 502 when the conversion failed or timed out.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/artifacts/[id]/pdf">) {
  const o = open(req);
  if ("res" in o) return o.res;
  const { id } = await ctx.params;
  if (!isArtifactId(id)) return bad("id must be 32 hex characters", 422);
  const hit = resolveArtifact(o.db, id);
  if (!hit) return bad("not found", 404);
  if (hit.artifact.kind !== "office") return bad("không phải file Office", 422);
  if (!findSoffice()) return bad("máy này chưa cài LibreOffice", 501);
  const st = fs.statSync(hit.file.path);
  const pdf = await officePdf(hit.file.path, st.size, st.mtimeMs);
  if (!pdf) return bad("LibreOffice không chuyển được file này sang PDF", 502);
  const size = fs.statSync(pdf).size;
  return sendFile(req, { path: pdf, name: hit.file.name.replace(/\.[^.]+$/, "") + ".pdf", type: "application/pdf", size }, { download: false, cache: "private, no-cache", headers: ARTIFACT_HEADERS });
}
