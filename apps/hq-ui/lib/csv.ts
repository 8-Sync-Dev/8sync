// CSV/TSV for the Kết quả preview's table: RFC 4180 quoting ("a ""b""", fields spanning lines), either
// line end, a BOM dropped. Stops after `maxRows` rows and reports whether more were left.

export function parseDelimited(text: string, delim: string, maxRows = 500): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    field = "";
    rows.push(row);
    row = [];
  };
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      endRow();
      if (rows.length >= maxRows) return { rows, more: i + 1 < text.length };
    } else field += c;
  }
  if (field !== "" || row.length) endRow();
  return { rows, more: false };
}
