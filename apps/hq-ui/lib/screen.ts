// What a background room's terminal shows right now, from the raw bytes `8sync ccc term` relays
// (ConPTY output: cursor moves, erases, colours). A small VT subset rendered onto a grid, then the
// dialog checks the one-tap answers rely on: a click is only sent while the screen still shows the
// dialog it answers. Pure; tested in tests/answer.test.ts.

/** The screen as text lines (trailing blanks trimmed). Unknown sequences are skipped. */
export function renderScreen(raw: string, cols = 120, rows = 34): string[] {
  const blank = () => Array<string>(cols).fill(" ");
  const grid = Array.from({ length: rows }, blank);
  let r = 0;
  let c = 0;
  let saved: [number, number] = [0, 0];
  const clampR = (v: number) => Math.min(rows - 1, Math.max(0, v));
  const clampC = (v: number) => Math.min(cols - 1, Math.max(0, v));
  const down = () => {
    if (r === rows - 1) {
      grid.shift();
      grid.push(blank());
    } else r++;
  };
  const chars = Array.from(raw);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === "\x1b") {
      const n = chars[i + 1];
      if (n === "[") {
        let j = i + 2;
        let params = "";
        while (j < chars.length && !/[@-~]/.test(chars[j])) params += chars[j++];
        const fin = chars[j];
        i = j;
        const nums = params.replace(/^[?>=!]/, "").split(";").map((x) => Number.parseInt(x, 10));
        const p = (k: number, d = 1) => (Number.isFinite(nums[k]) && nums[k] > 0 ? nums[k] : d);
        const p0 = Number.isFinite(nums[0]) ? nums[0] : 0;
        switch (fin) {
          case "H":
          case "f":
            r = clampR(p(0) - 1);
            c = clampC(p(1) - 1);
            break;
          case "A":
            r = clampR(r - p(0));
            break;
          case "B":
            r = clampR(r + p(0));
            break;
          case "C":
            c = clampC(c + p(0));
            break;
          case "D":
            c = clampC(c - p(0));
            break;
          case "E":
            r = clampR(r + p(0));
            c = 0;
            break;
          case "F":
            r = clampR(r - p(0));
            c = 0;
            break;
          case "G":
            c = clampC(p(0) - 1);
            break;
          case "d":
            r = clampR(p(0) - 1);
            break;
          case "K":
            if (p0 === 0) grid[r].fill(" ", Math.min(c, cols));
            else if (p0 === 1) grid[r].fill(" ", 0, Math.min(c + 1, cols));
            else grid[r].fill(" ");
            break;
          case "J":
            if (p0 === 0) {
              grid[r].fill(" ", Math.min(c, cols));
              for (let k = r + 1; k < rows; k++) grid[k].fill(" ");
            } else if (p0 === 1) {
              for (let k = 0; k < r; k++) grid[k].fill(" ");
              grid[r].fill(" ", 0, Math.min(c + 1, cols));
            } else for (const line of grid) line.fill(" ");
            break;
          case "X":
            grid[r].fill(" ", Math.min(c, cols), Math.min(c + p(0), cols));
            break;
          case "s":
            saved = [r, c];
            break;
          case "u":
            [r, c] = saved;
            break;
        }
      } else if (n === "]") {
        // OSC (title, hyperlink): up to BEL or ESC \
        let j = i + 2;
        while (j < chars.length && chars[j] !== "\x07" && !(chars[j] === "\x1b" && chars[j + 1] === "\\")) j++;
        i = chars[j] === "\x1b" ? j + 1 : j;
      } else if (n === "(" || n === ")") i += 2;
      else if (n === "7") {
        saved = [r, c];
        i++;
      } else if (n === "8") {
        [r, c] = saved;
        i++;
      } else i++;
      continue;
    }
    if (ch === "\r") c = 0;
    else if (ch === "\n") down();
    else if (ch === "\b") c = Math.max(0, c - 1);
    else if (ch === "\t") c = Math.min(cols - 1, (Math.floor(c / 8) + 1) * 8);
    else if (ch >= " " && ch !== "\x7f") {
      if (c >= cols) {
        c = 0;
        down();
      }
      grid[r][c++] = ch;
    }
  }
  return grid.map((l) => l.join("").trimEnd());
}

const BOX = /[│┃╭╮╰╯─━┌┐└┘]/g;
/** One comparable string: box drawing and runs of whitespace collapsed. */
export const flatText = (s: string) => s.replace(BOX, " ").replace(/\s+/g, " ").trim();
const clean = (l: string) => l.replace(/^\s*[│┃]\s?/, "").replace(/\s*[│┃]\s*$/, "").trimEnd();
const RULE = /^\s*[╭╰┌└]?[─━]{6,}/;
/** Claude Code's permission dialog question (lib/server/pane.ts lists the same family). */
const PROCEED = /Do you want to (proceed|make this edit|create|edit|run|allow|fetch|use)\b/i;
const MAX_TEXT = 1500;

export type ScreenPermission = { text: string; yes: boolean };

/**
 * A permission dialog on screen: `text` is its block (tool, the exact command, the question), `yes`
 * = the cursor sits on "1. Yes", so Enter allows. Null when no such dialog shows.
 */
export function permissionOnScreen(lines: string[]): ScreenPermission | null {
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--)
    if (PROCEED.test(lines[i])) {
      at = i;
      break;
    }
  if (at < 0) return null;
  const below = lines.slice(at + 1, at + 6);
  if (!below.some((l) => /\b1\.\s*Yes\b/.test(l))) return null;
  const yes = below.some((l) => /^\s*[│┃]?\s*[❯›>]\s*1\.\s*Yes\b/.test(l));
  let s = at;
  while (s > 0 && at - s < 16 && !RULE.test(lines[s - 1])) s--;
  const text = lines
    .slice(s, at + 1)
    .map(clean)
    .filter((l) => l.trim())
    .join("\n")
    .slice(0, MAX_TEXT);
  return { text, yes };
}

/**
 * An AskUserQuestion on screen: its question text and every option (`n. label`) must show. Returns
 * the question as the screen renders it, null when the screen moved on.
 */
export function questionOnScreen(lines: string[], question: string, options: readonly string[]): string | null {
  const flat = flatText(lines.join("\n"));
  const want = flatText(question).slice(0, 60);
  if (!want || !flat.includes(want)) return null;
  for (let k = 0; k < options.length; k++) {
    const label = flatText(options[k]).slice(0, 30);
    if (!flat.includes(`${k + 1}. ${label}`)) return null;
  }
  const head = flatText(question).slice(0, 20);
  const start = lines.findIndex((l) => flatText(l).includes(head));
  if (start < 0) return want;
  const out: string[] = [];
  for (let i = start; i < lines.length && out.length < 8; i++) {
    if (/^\s*[│┃]?\s*[❯›>]?\s*1\.\s/.test(lines[i])) break;
    if (lines[i].trim()) out.push(clean(lines[i]).trim());
  }
  return out.join("\n").slice(0, MAX_TEXT) || want;
}
