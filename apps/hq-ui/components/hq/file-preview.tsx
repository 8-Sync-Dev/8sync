"use client";

// Viewing a result file inside HQ: the frame/table/text pieces of the artifact viewer and its Office view
// (PDF through LibreOffice, else read in the browser). Shared by artifacts-view.tsx and the "Thư mục"/path
// viewer (files-sheet.tsx) without pulling the whole artifact screen into the main bundle.
import { useEffect, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { officeReadable } from "@/lib/artifacts";
import type { OfficeDoc } from "@/lib/office-preview";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/** An embedded result (PDF, HTML) at reading height. */
export const FRAME = "h-[min(78dvh,60rem)] w-full rounded-lg border";

/** A text result with its "Chép" in the corner. */
export function TextFrame({ copy, children }: { copy: string; children: ReactNode }) {
  return (
    <div className="relative min-h-full rounded-lg border bg-muted/40 p-3 pt-9">
      <div className="absolute top-1.5 right-1.5">
        <CopyButton value={copy} label="Chép nội dung file" text />
      </div>
      {children}
    </div>
  );
}

export function DataTable({ rows, header = false, more = null }: { rows: string[][]; header?: boolean; more?: string | null }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">Trống.</p>;
  const [head, ...rest] = header ? rows : [null, ...rows];
  return (
    <div className="overflow-auto rounded-md border bg-background">
      <table className="w-max min-w-full border-collapse text-xs tabular">
        {head && (
          <thead className="sticky top-0 bg-muted">
            <tr>
              {head.map((c, i) => (
                <th key={i} scope="col" className="border-b px-2 py-1.5 text-left font-semibold whitespace-pre-wrap">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rest.map((r, i) => (
            <tr key={i} className="odd:bg-muted/30">
              {(r ?? []).map((c, j) => (
                <td key={j} className="max-w-96 border-b px-2 py-1 align-top whitespace-pre-wrap">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {more && <p className="px-2 py-1.5 text-xs text-muted-foreground">{more}</p>}
    </div>
  );
}

type OfficeState = { key: string } & ({ mode: "pdf"; url: string } | { mode: "doc"; doc: OfficeDoc; text: string } | { mode: "none"; why: string });

/**
 * An Office file: as PDF when LibreOffice is on HQ's machine (`pdfUrl`: GET /api/artifacts/<id>/pdf or
 * /api/files/pdf, 501 without LibreOffice), else read here from its bytes (`fileUrl`; docx/xlsx/pptx/
 * odt/ods/odp, lib/office-preview.ts, loaded only now), else `fallback` with the reason. `version`
 * changes when the file does. Also the "Thư mục"/path viewer's Office view (files-sheet.tsx).
 */
export function OfficePreview({
  name,
  title,
  pdfUrl,
  fileUrl,
  token,
  version,
  fallback,
}: {
  name: string;
  title: string;
  pdfUrl: string;
  fileUrl: string;
  token: string;
  version: string;
  fallback: (why: string) => ReactNode;
}) {
  const key = `${pdfUrl}:${version}`;
  const [st, setSt] = useState<OfficeState | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    let obj: string | null = null;
    const headers = { "x-hq-token": token };
    (async () => {
      const r = await fetch(pdfUrl, { headers, signal: ac.signal, cache: "no-store" });
      if (r.ok) {
        obj = URL.createObjectURL(await r.blob());
        return setSt({ key, mode: "pdf", url: obj });
      }
      const noSoffice = r.status === 501;
      if (!officeReadable(name)) {
        return setSt({
          key,
          mode: "none",
          why: noSoffice ? "File Office đời cũ (.doc/.xls/.ppt) cần LibreOffice trên máy chạy HQ để xem trước." : "LibreOffice không chuyển được file này.",
        });
      }
      const [file, mod] = await Promise.all([fetch(fileUrl, { headers, signal: ac.signal, cache: "no-store" }), import("@/lib/office-preview")]);
      const doc = file.ok ? await mod.readOffice(name, await file.arrayBuffer()) : null;
      setSt(doc ? { key, mode: "doc", doc, text: mod.officeText(doc) } : { key, mode: "none", why: "File hỏng hoặc định dạng này chưa đọc được." });
    })().catch(() => {
      if (!ac.signal.aborted) setSt({ key, mode: "none", why: "HQ không đọc được file lúc này." });
    });
    return () => {
      ac.abort();
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [name, pdfUrl, fileUrl, key, token]);
  const cur = st && st.key === key ? st : null;
  if (!cur) return <Skeleton className="h-[min(70dvh,40rem)] w-full rounded-lg" />;
  if (cur.mode === "pdf") return <iframe src={cur.url} title={title} className={FRAME} />;
  if (cur.mode === "none") return fallback(cur.why);
  return <OfficeDocView doc={cur.doc} text={cur.text} />;
}

function OfficeDocView({ doc, text }: { doc: OfficeDoc; text: string }) {
  return (
    <TextFrame copy={text}>
      <p className="mb-3 text-[11px] text-muted-foreground">Bản xem nhanh (chữ và bảng, chưa có định dạng). Cài LibreOffice trên máy chạy HQ để xem đúng như file gốc.</p>
      {doc.kind === "doc" && (
        <div className="max-w-3xl space-y-2 text-sm leading-relaxed">
          {doc.blocks.map((b, i) =>
            b.t === "h" ? (
              <p key={i} role="heading" aria-level={Math.min(b.level + 3, 6)} className={cn("font-semibold text-pretty", b.level <= 1 ? "pt-2 text-lg" : b.level === 2 ? "pt-1.5 text-base" : "text-sm")}>
                {b.text}
              </p>
            ) : b.t === "li" ? (
              <p key={i} className="flex gap-2 whitespace-pre-wrap" style={{ paddingLeft: `${b.depth * 1.25}rem` }}>
                <span aria-hidden className="text-muted-foreground">•</span>
                <span>{b.text}</span>
              </p>
            ) : b.t === "table" ? (
              <DataTable key={i} rows={b.rows} />
            ) : (
              <p key={i} className="whitespace-pre-wrap text-pretty">
                {b.text}
              </p>
            ),
          )}
          {doc.more && <p className="text-xs text-muted-foreground">Còn nữa: tải về để đọc hết.</p>}
        </div>
      )}
      {doc.kind === "sheet" && (
        <div className="space-y-4">
          {doc.sheets.map((s, i) => (
            <section key={i} aria-label={s.name} className="space-y-1.5">
              <h4 className="text-xs font-semibold">{s.name}</h4>
              <DataTable rows={s.rows} more={s.more ? "Còn nữa: tải về để xem hết." : null} />
            </section>
          ))}
          {doc.moreSheets > 0 && <p className="text-xs text-muted-foreground">Còn {doc.moreSheets} sheet nữa trong file.</p>}
        </div>
      )}
      {doc.kind === "slides" && (
        <ol className="grid gap-3 sm:grid-cols-2">
          {doc.slides.map((s, i) => (
            <li key={i} className="flex aspect-video min-w-0 flex-col gap-1.5 overflow-hidden rounded-md border bg-background p-3">
              <span className="text-[11px] text-muted-foreground tabular">Slide {i + 1}</span>
              {s.title && <p className="text-sm font-semibold text-pretty">{s.title}</p>}
              <ul className="min-h-0 space-y-0.5 overflow-hidden text-xs text-foreground/80">
                {s.lines.map((l, j) => (
                  <li key={j} className="whitespace-pre-wrap">
                    {l}
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {doc.more && <li className="text-xs text-muted-foreground">Còn nữa: tải về để xem hết.</li>}
        </ol>
      )}
    </TextFrame>
  );
}
