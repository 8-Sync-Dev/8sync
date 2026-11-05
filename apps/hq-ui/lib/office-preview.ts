// Office files read in the browser when HQ's machine has no LibreOffice (lib/server/office-pdf.ts): Word
// and Writer as headings, paragraphs, lists and tables; Excel and Calc as the first sheets' cells; PowerPoint
// and Impress as each slide's text. Plain data the view renders as React text (no HTML is ever made from
// the file, so nothing in it can run). Loaded with `import()` only when such a file is opened.
import { extOf, officeFamily } from "./artifacts";
import { readZipText } from "./zip-read";

export type DocBlock = { t: "h"; level: number; text: string } | { t: "p"; text: string } | { t: "li"; depth: number; text: string } | { t: "table"; rows: string[][] };
export type Sheet = { name: string; rows: string[][]; more: boolean };
export type Slide = { title: string; lines: string[] };
export type OfficeDoc =
  | { kind: "doc"; blocks: DocBlock[]; more: boolean }
  | { kind: "sheet"; sheets: Sheet[]; moreSheets: number }
  | { kind: "slides"; slides: Slide[]; more: boolean };

export const DOC_BLOCKS_MAX = 3000;
export const SHEETS_MAX = 3;
export const SHEET_ROWS_MAX = 300;
export const SHEET_COLS_MAX = 40;
export const SLIDES_MAX = 300;
/** Lists/sections nested deeper than this are left out: a crafted file cannot recurse the walk into a stack overflow. */
export const ODF_NEST_MAX = 6;
/** Inline elements (spans, runs, links) nested deeper than this contribute no text, for the same reason. */
export const INLINE_NEST_MAX = 32;

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
const kids = (el: Element, name?: string) => [...el.children].filter((c) => !name || c.localName === name);
const firstDeep = (el: Element | Document, name: string) => el.getElementsByTagNameNS("*", name)[0] ?? null;
const allDeep = (el: Element | Document, name: string) => [...el.getElementsByTagNameNS("*", name)];

/** Text of an OOXML paragraph or run tree: `t` text, `tab` as a tab, `br`/`cr` as a line break, in order. */
function ooxmlText(el: Element): string {
  let s = "";
  const walk = (n: Element, d: number) => {
    if (d > INLINE_NEST_MAX) return;
    for (const c of n.children) {
      if (c.localName === "t") s += c.textContent ?? "";
      else if (c.localName === "tab") s += "\t";
      else if (c.localName === "br" || c.localName === "cr") s += "\n";
      else if (c.localName !== "delText" && c.localName !== "instrText" && c.localName !== "rPh") walk(c, d + 1);
    }
  };
  walk(el, 0);
  return s;
}

/** Text of an OpenDocument paragraph: `text:s` spaces, `text:tab`, `text:line-break`, notes left out. */
function odfText(el: Element): string {
  let s = "";
  const walk = (n: Node, d: number) => {
    if (d > INLINE_NEST_MAX) return;
    for (const c of n.childNodes) {
      if (c.nodeType === Node.TEXT_NODE) s += c.nodeValue ?? "";
      else if (c.nodeType === Node.ELEMENT_NODE) {
        const e = c as Element;
        if (e.localName === "s") s += " ".repeat(Math.min(Number(e.getAttribute("text:c") ?? 1) || 1, 100));
        else if (e.localName === "tab") s += "\t";
        else if (e.localName === "line-break") s += "\n";
        else if (e.localName !== "note" && e.localName !== "annotation") walk(e, d + 1);
      }
    }
  };
  walk(el, 0);
  return s;
}

/** Relationship id → part path, for a `.rels` file next to `dir` (targets are relative to `dir`). */
function rels(text: string | undefined, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!text) return out;
  for (const r of allDeep(xml(text), "Relationship")) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target");
    if (!id || !target || r.getAttribute("TargetMode") === "External") continue;
    out.set(id, normPart(target.startsWith("/") ? target.slice(1) : `${dir}/${target}`));
  }
  return out;
}

/** "xl/worksheets/../sharedStrings.xml" → "xl/sharedStrings.xml". */
function normPart(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "..") out.pop();
    else if (seg && seg !== ".") out.push(seg);
  }
  return out.join("/");
}

/** "AB12" → column index 27 (0-based). */
function colOf(ref: string | null): number | null {
  const m = ref ? /^([A-Z]{1,3})\d*$/.exec(ref) : null;
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const trimRow = (r: string[]) => {
  let n = r.length;
  while (n > 0 && !r[n - 1]) n--;
  return r.slice(0, n);
};

function docx(parts: Map<string, string>): OfficeDoc {
  const body = firstDeep(xml(parts.get("word/document.xml") ?? "<x/>"), "body");
  const blocks: DocBlock[] = [];
  let more = false;
  const add = (b: DocBlock) => {
    if (blocks.length >= DOC_BLOCKS_MAX) more = true;
    else blocks.push(b);
  };
  const walk = (el: Element, nest: number) => {
    if (nest > ODF_NEST_MAX) return;
    for (const c of el.children) {
      if (c.localName === "p") {
        const text = ooxmlText(c).trim();
        if (!text) continue;
        const pPr = kids(c, "pPr")[0];
        const style = pPr ? (kids(pPr, "pStyle")[0]?.getAttribute("w:val") ?? "") : "";
        const h = /^(?:heading|berschrift|titre)\s?(\d)$/i.exec(style);
        const num = pPr ? kids(pPr, "numPr")[0] : undefined;
        if (/^title$/i.test(style)) add({ t: "h", level: 1, text });
        else if (h) add({ t: "h", level: Math.min(Number(h[1]), 6), text });
        else if (num) add({ t: "li", depth: Math.min(Number(kids(num, "ilvl")[0]?.getAttribute("w:val") ?? 0) || 0, 6), text });
        else add({ t: "p", text });
      } else if (c.localName === "tbl") {
        const rows = kids(c, "tr")
          .slice(0, SHEET_ROWS_MAX)
          .map((tr) => kids(tr, "tc").slice(0, SHEET_COLS_MAX).map((tc) => kids(tc, "p").map(ooxmlText).join("\n").trim()));
        if (rows.length) add({ t: "table", rows });
      } else if (c.localName === "sdt" || c.localName === "sdtContent" || c.localName === "customXml") walk(c, nest + 1);
    }
  };
  if (body) walk(body, 0);
  return { kind: "doc", blocks, more };
}

function xlsx(parts: Map<string, string>): OfficeDoc {
  const shared = allDeep(xml(parts.get("xl/sharedStrings.xml") ?? "<x/>"), "si").map(ooxmlText);
  const wbRels = rels(parts.get("xl/_rels/workbook.xml.rels"), "xl");
  const sheetEls = allDeep(xml(parts.get("xl/workbook.xml") ?? "<x/>"), "sheet");
  const sheets: Sheet[] = [];
  for (const s of sheetEls.slice(0, SHEETS_MAX)) {
    const target = wbRels.get(s.getAttribute("r:id") ?? "");
    const doc = target ? parts.get(target) : undefined;
    if (!doc) continue;
    const rows: string[][] = [];
    const rowEls = allDeep(xml(doc), "row");
    for (const r of rowEls.slice(0, SHEET_ROWS_MAX)) {
      const row: string[] = [];
      kids(r, "c").forEach((c, i) => {
        const col = colOf(c.getAttribute("r")) ?? i;
        if (col >= SHEET_COLS_MAX) return;
        const t = c.getAttribute("t");
        const v = kids(c, "v")[0]?.textContent ?? "";
        const val = t === "s" ? (shared[Number(v)] ?? "") : t === "inlineStr" ? ooxmlText(kids(c, "is")[0] ?? c) : t === "b" ? (v === "1" ? "TRUE" : "FALSE") : v;
        while (row.length < col) row.push("");
        row[col] = val;
      });
      rows.push(trimRow(row));
    }
    while (rows.length && !rows.at(-1)!.length) rows.pop();
    sheets.push({ name: s.getAttribute("name") ?? `Sheet ${sheets.length + 1}`, rows, more: rowEls.length > SHEET_ROWS_MAX });
  }
  return { kind: "sheet", sheets, moreSheets: Math.max(0, sheetEls.length - SHEETS_MAX) };
}

function pptx(parts: Map<string, string>): OfficeDoc {
  const pRels = rels(parts.get("ppt/_rels/presentation.xml.rels"), "ppt");
  let order = allDeep(xml(parts.get("ppt/presentation.xml") ?? "<x/>"), "sldId")
    .map((s) => pRels.get(s.getAttribute("r:id") ?? ""))
    .filter((p): p is string => !!p && parts.has(p));
  if (!order.length) {
    order = [...parts.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => Number(/\d+/.exec(a.slice(11))?.[0]) - Number(/\d+/.exec(b.slice(11))?.[0]));
  }
  const slides: Slide[] = order.slice(0, SLIDES_MAX).map((p) => {
    const d = xml(parts.get(p)!);
    let title = "";
    const lines: string[] = [];
    for (const sp of allDeep(d, "sp")) {
      const ph = firstDeep(sp, "ph");
      const isTitle = !!ph && /^(?:title|ctrTitle)$/.test(ph.getAttribute("type") ?? "");
      const paras = allDeep(sp, "p")
        .filter((x) => x.namespaceURI?.includes("drawingml"))
        .map((x) => ooxmlText(x).trim())
        .filter(Boolean);
      if (isTitle && !title) title = paras.join(" ");
      else lines.push(...paras);
    }
    for (const tbl of allDeep(d, "tbl")) for (const tr of allDeep(tbl, "tr")) lines.push(allDeep(tr, "tc").map((tc) => ooxmlText(tc).trim()).join(" · "));
    return { title, lines };
  });
  return { kind: "slides", slides, more: order.length > SLIDES_MAX };
}

function odf(parts: Map<string, string>, family: "doc" | "sheet" | "slides"): OfficeDoc {
  const d = xml(parts.get("content.xml") ?? "<x/>");
  if (family === "sheet") {
    const tables = allDeep(d, "table").filter((t) => t.namespaceURI?.includes("table"));
    const sheets: Sheet[] = tables.slice(0, SHEETS_MAX).map((t, i) => {
      const rows: string[][] = [];
      let more = false;
      for (const r of allDeep(t, "table-row")) {
        const row: string[] = [];
        for (const c of kids(r).filter((x) => x.localName === "table-cell" || x.localName === "covered-table-cell")) {
          const text = kids(c, "p").map(odfText).join("\n");
          const rep = Math.min(Number(c.getAttribute("table:number-columns-repeated") ?? 1) || 1, SHEET_COLS_MAX);
          for (let k = 0; k < rep && row.length < SHEET_COLS_MAX; k++) row.push(text);
        }
        const cells = trimRow(row);
        const rep = Math.min(Number(r.getAttribute("table:number-rows-repeated") ?? 1) || 1, SHEET_ROWS_MAX);
        for (let k = 0; k < rep; k++) {
          if (rows.length >= SHEET_ROWS_MAX) {
            more = more || cells.length > 0;
            break;
          }
          rows.push(cells);
        }
      }
      while (rows.length && !rows.at(-1)!.length) rows.pop();
      return { name: t.getAttribute("table:name") ?? `Sheet ${i + 1}`, rows, more };
    });
    return { kind: "sheet", sheets, moreSheets: Math.max(0, tables.length - SHEETS_MAX) };
  }
  if (family === "slides") {
    const pages = allDeep(d, "page").filter((p) => p.namespaceURI?.includes("drawing"));
    const slides = pages.slice(0, SLIDES_MAX).map((pg) => {
      const lines = [...allDeep(pg, "h"), ...allDeep(pg, "p")]
        .filter((x) => x.namespaceURI?.includes(":text:"))
        .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
        .map((x) => odfText(x).trim())
        .filter(Boolean);
      return { title: lines[0] ?? pg.getAttribute("draw:name") ?? "", lines: lines.slice(1) };
    });
    return { kind: "slides", slides, more: pages.length > SLIDES_MAX };
  }
  const text = firstDeep(d, "text");
  const out = text ? odfBlocks(text) : { blocks: [], more: false };
  return { kind: "doc", ...out };
}

/**
 * The blocks of an OpenDocument `office:text`: headings, paragraphs, list items (with their depth),
 * tables. Lists and sections count toward ODF_NEST_MAX; deeper ones are left out.
 */
export function odfBlocks(text: Element): { blocks: DocBlock[]; more: boolean } {
  const blocks: DocBlock[] = [];
  let more = false;
  const add = (b: DocBlock) => {
    if (blocks.length >= DOC_BLOCKS_MAX) more = true;
    else blocks.push(b);
  };
  const walk = (el: Element, depth: number, nest: number) => {
    if (nest > ODF_NEST_MAX) return;
    for (const c of el.children) {
      if (c.localName === "h") {
        const t = odfText(c).trim();
        if (t) add({ t: "h", level: Math.min(Number(c.getAttribute("text:outline-level") ?? 1) || 1, 6), text: t });
      } else if (c.localName === "p") {
        const t = odfText(c).trim();
        if (t) add(depth >= 0 ? { t: "li", depth, text: t } : { t: "p", text: t });
      } else if (c.localName === "list") walk(c, depth + 1, nest + 1);
      else if (c.localName === "list-item") walk(c, depth, nest);
      else if (c.localName === "table") {
        const rows = allDeep(c, "table-row")
          .slice(0, SHEET_ROWS_MAX)
          .map((r) => kids(r, "table-cell").slice(0, SHEET_COLS_MAX).map((tc) => kids(tc, "p").map(odfText).join("\n").trim()));
        if (rows.length) add({ t: "table", rows });
      } else if (c.localName === "section") walk(c, depth, nest + 1);
    }
  };
  walk(text, -1, 0);
  return { blocks, more };
}

/** The parts each format needs, so a big embedded video is never inflated. */
function wanted(ext: string): (name: string) => boolean {
  if (ext === ".docx") return (n) => n === "word/document.xml";
  if (ext === ".xlsx") return (n) => n === "xl/workbook.xml" || n === "xl/sharedStrings.xml" || n === "xl/_rels/workbook.xml.rels" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n);
  if (ext === ".pptx") return (n) => n === "ppt/presentation.xml" || n === "ppt/_rels/presentation.xml.rels" || /^ppt\/slides\/slide\d+\.xml$/.test(n);
  return (n) => n === "content.xml";
}

/** `buf` (the file named `name`) as an OfficeDoc; null for a format the browser cannot read (doc/xls/ppt) or a broken file. */
export async function readOffice(name: string, buf: ArrayBuffer): Promise<OfficeDoc | null> {
  const ext = extOf(name);
  const family = officeFamily(name);
  if (!family || ![".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"].includes(ext)) return null;
  const parts = await readZipText(buf, wanted(ext));
  if (!parts || !parts.size) return null;
  if (ext === ".docx") return docx(parts);
  if (ext === ".xlsx") return xlsx(parts);
  if (ext === ".pptx") return pptx(parts);
  return odf(parts, family);
}

/** The document as plain text: what "Chép" copies (tab-separated cells, one line per paragraph or row). */
export function officeText(d: OfficeDoc): string {
  if (d.kind === "doc") return d.blocks.map((b) => (b.t === "table" ? b.rows.map((r) => r.join("\t")).join("\n") : b.t === "li" ? `${"  ".repeat(b.depth)}- ${b.text}` : b.text)).join("\n\n");
  if (d.kind === "sheet") return d.sheets.map((s) => `# ${s.name}\n${s.rows.map((r) => r.join("\t")).join("\n")}`).join("\n\n");
  return d.slides.map((s, i) => [`${i + 1}. ${s.title}`, ...s.lines].join("\n")).join("\n\n");
}
