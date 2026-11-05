import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { COMPOSER_MAX, QUOTE_MAX, askRoomFor, fileRefsIn, quoteForAsk, withQuote } from "@/lib/ask-quote";
import { parseDelimited } from "@/lib/csv";
import { ZIP_ENTRY_MAX, readZipText } from "@/lib/zip-read";

describe("quoteForAsk", () => {
  it("quotes each selected line under where it came from, ready for the question", () => {
    expect(quoteForAsk("Bước 2 lỗi\r\n\r\n\r\nvì thiếu key  \n", "Sửa build Windows")).toBe("Về «Sửa build Windows»:\n> Bước 2 lỗi\n>\n> vì thiếu key\n\n");
    expect(quoteForAsk("một dòng", null)).toBe("> một dòng\n\n");
    expect(quoteForAsk(" \n\t ", "x")).toBe("");
  });

  it("cuts a long selection and a long reference", () => {
    const q = quoteForAsk("a".repeat(QUOTE_MAX + 50), "r".repeat(300));
    expect(q).toContain(`> ${"a".repeat(QUOTE_MAX)}…\n`);
    expect(q.split("\n")[0]).toBe(`Về «${"r".repeat(119)}…»:`);
  });
});

describe("withQuote", () => {
  it("puts the quote alone into an empty draft and after a blank line otherwise, within the composer's limit", () => {
    expect(withQuote("", "> a\n\n")).toBe("> a\n\n");
    expect(withQuote("đang viết  \n", "> a\n\n")).toBe("đang viết\n\n> a\n\n");
    expect(withQuote("x".repeat(COMPOSER_MAX), "> a\n\n")).toHaveLength(COMPOSER_MAX);
  });
});

describe("fileRefsIn", () => {
  it("picks absolute Windows paths and backticked paths with a folder and an extension, once each", () => {
    const text = [
      "Đã sửa `apps/hq-ui/lib/x.ts` và `./README.md`, xem C:\\Users\\me\\out\\report.pdf.",
      "Log: C:/tmp/run.log:12, lại `apps/hq-ui/lib/x.ts`.",
      "Không lấy: `x.ts`, `npm run build`, https://example.com/a.js, `src/*.ts`, `/usr/bin/env`.",
      "`/var/log/app.log`",
    ].join("\n");
    expect(fileRefsIn(text)).toEqual(["apps/hq-ui/lib/x.ts", "./README.md", "/var/log/app.log", "C:\\Users\\me\\out\\report.pdf", "C:/tmp/run.log"]);
  });
});

describe("askRoomFor", () => {
  const r = (name: string, root: string, last: number, status = "running", session_id: string | null = null) => ({ name, session_id, status, cwd: root, project: { root }, last_active: last });
  it("asks the live room that made the result, else the project's latest live room, else none", () => {
    const rooms = [r("a", "C:\\x\\app", 5), r("b", "c:/x/app", 9), r("maker", "C:\\x\\app", 1, "idle", "omp-0123456789abcdef"), r("old", "C:\\x\\site", 99, "ended")];
    const art = (session: string | null, root: string, for_root: string | null = null) => ({ session, root, for_root });
    expect(askRoomFor(art("omp-0123456789abcdef", "C:\\x\\app"), rooms)?.name).toBe("maker");
    expect(askRoomFor(art(null, "C:/X/App"), rooms)?.name).toBe("b");
    expect(askRoomFor(art("gone-room", "C:\\x\\site"), rooms)).toBeNull();
    expect(askRoomFor(art(null, "C:\\x\\site", "C:\\x\\app"), rooms)?.name).toBe("b");
  });
});

describe("parseDelimited", () => {
  it("reads quoted fields, doubled quotes, line breaks inside quotes and both line ends", () => {
    const t = '\ufefftên,ghi chú\r\n"Nguyễn, A","nói ""chào""\nrồi đi"\nB,\n';
    expect(parseDelimited(t, ",")).toEqual({ rows: [["tên", "ghi chú"], ["Nguyễn, A", 'nói "chào"\nrồi đi'], ["B", ""]], more: false });
    expect(parseDelimited("a\tb\nc\td", "\t").rows).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseDelimited("1\n2\n3\n", ",", 2)).toEqual({ rows: [["1"], ["2"]], more: true });
  });
});

/** A zip of deflated entries, the way Office writes them. */
function zip(entries: Record<string, Buffer>): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let off = 0;
  for (const [name, data] of Object.entries(entries)) {
    const comp = zlib.deflateRawSync(data);
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(off, 42);
    locals.push(lh, n, comp);
    centrals.push(ch, n);
    off += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  const all = Buffer.concat([...locals, cd, end]);
  return all.buffer.slice(all.byteOffset, all.byteOffset + all.byteLength) as ArrayBuffer;
}

describe("readZipText", () => {
  it("reads the parts asked for and leaves out one that inflates past the cap (a zip bomb)", async () => {
    const buf = zip({
      "word/document.xml": Buffer.from("<w:document>xin chào</w:document>"),
      "word/media/big.bin": Buffer.alloc(10),
      "bomb.xml": Buffer.alloc(ZIP_ENTRY_MAX + 1024 * 1024),
    });
    const got = await readZipText(buf, (n) => n.endsWith(".xml"));
    expect(got && [...got.keys()]).toEqual(["word/document.xml"]);
    expect(got?.get("word/document.xml")).toBe("<w:document>xin chào</w:document>");
    expect(await readZipText(new ArrayBuffer(64), () => true)).toBeNull();
  });
});
