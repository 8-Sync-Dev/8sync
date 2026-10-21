const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/**
 * What the terminal's input bar sends for `text`, ending in Enter. Several lines go as one bracketed
 * paste (the program gets them as pasted text, line breaks as `\r` like xterm's own paste) when the
 * terminal turned bracketed paste on; otherwise each line goes with its own Enter, as a plain paste
 * into a terminal does (a shell runs them one by one). Trailing line breaks are dropped; an empty
 * text is a bare Enter.
 */
export function lineBytes(text: string, bracketed: boolean): string {
  const body = text.replace(/[\r\n]+$/, "");
  if (!/[\r\n]/.test(body)) return `${body}\r`;
  const lines = body.split(/\r\n?|\n/);
  if (bracketed) return `${PASTE_START}${lines.join("\r").replaceAll(PASTE_END, "")}${PASTE_END}\r`;
  return `${lines.join("\r")}\r`;
}
