import { ARTIFACT_HEADERS } from "@/lib/artifact-headers";
import { fileType } from "@/lib/artifacts";
import { isFail, filesRoot, rawFile } from "@/lib/server/files";
import { bad, open } from "@/lib/server/http";
import { knownRoots } from "@/lib/server/in-view";
import { findSoffice, officePdf } from "@/lib/server/office-pdf";
import { sendFile } from "@/lib/server/send-file";
import fs from "node:fs";

export const runtime = "nodejs";

/**
 * `?root=&path=`: an Office file of the "Thư mục"/path viewer as PDF, made by LibreOffice on this machine
 * (lib/server/office-pdf.ts, cached) like GET /api/artifacts/<id>/pdf. The file resolves exactly as in
 * /api/files/raw (known project, inside the root, no secrets). 501 without LibreOffice (the viewer then
 * reads docx/xlsx/pptx/OpenDocument itself), 422 for a file that is not Office, 502 when the conversion
 * failed or timed out. Owner only (`x-hq-token`).
 */
export async function GET(req: Request) {
  const o = open(req);
  if ("res" in o) return o.res;
  const q = new URL(req.url).searchParams;
  const root = filesRoot(q.get("root") ?? "", await knownRoots(o.db, { ended: true }));
  if (isFail(root)) return bad(root.error, root.status);
  const f = rawFile(root, q.get("path") ?? "");
  if (isFail(f)) return bad(f.error, f.status);
  if (fileType(f.name)?.kind !== "office") return bad("không phải file Office", 422);
  if (!findSoffice()) return bad("máy này chưa cài LibreOffice", 501);
  const pdf = await officePdf(f.path, f.size, fs.statSync(f.path).mtimeMs);
  if (!pdf) return bad("LibreOffice không chuyển được file này sang PDF", 502);
  const size = fs.statSync(pdf).size;
  return sendFile(req, { path: pdf, name: f.name.replace(/\.[^.]+$/, "") + ".pdf", type: "application/pdf", size }, { download: false, cache: "private, no-cache", headers: ARTIFACT_HEADERS });
}
