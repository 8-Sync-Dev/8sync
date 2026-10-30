/** Reads a `tmux capture-pane` snapshot for states the owner has to act on. */

const ESC = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][0-9A-Za-z]/g;

export function stripAnsi(s: string): string {
  return s.replace(ESC, "");
}

/** Claude Code's banner when the claude.ai org has not turned Channels on. */
const BLOCKED_BY_ORG = /Channels are not enabled|channelsEnabled/;

/** Most specific first. Only the bottom of the pane is checked: dialogs render there. */
// A cursor on a numbered option: Claude Code's select menu.
// The glyph must start the line: a markdown quote (`> 1. foo`) is not a cursor.
const MENU = /^\s*[❯›]\s*\d\.\s+\S/m;

// Footer hints of Claude Code's wizards and menus; present even when the dialog title is unknown.
const FOOTER = /Enter to (confirm|continue|select)|Esc to cancel|←\/→ to change/i;

const DIALOGS: { re: RegExp; label: string; menu?: boolean }[] = [
  { re: /trust (the files in )?this folder|Yes, I trust this folder/i, label: "Trust this folder?" },
  { re: /Teach auto mode/i, label: "Auto mode question" },
  // The flag name can also sit in a status line, so only count it with a menu open.
  { re: /development channels?|dangerously-load-development-channels/i, label: "Channel warning", menu: true },
  {
    re: /Do you want to (proceed|make this edit|create|edit|run|allow|fetch|use)|requires (your )?(approval|permission)/i,
    label: "Permission prompt",
  },
  { re: /Press Enter to continue/i, label: "Press Enter to continue" },
  { re: MENU, label: "Waiting for a choice" },
  { re: FOOTER, label: "Waiting for a choice" },
];

const TAIL_LINES = 20;
/** The org banner renders at the bottom; older assistant text that mentions it must not count. */
const BANNER_LINES = 12;

export type PaneState = { blocked: boolean; waiting: string | null };

export function detectPane(raw: string): PaneState {
  const lines = stripAnsi(raw)
    .split("\n")
    .filter((l) => l.trim() !== "");
  const tail = lines.slice(-TAIL_LINES).join("\n");
  const bannerTail = lines.slice(-BANNER_LINES).join("\n");
  const menu = MENU.test(tail);
  const hit = DIALOGS.find((d) => d.re.test(tail) && (!d.menu || menu));
  return { blocked: BLOCKED_BY_ORG.test(bannerTail), waiting: hit?.label ?? null };
}

/** The last lines of a CLI's own report, without colour codes. */
export function tail(text: string, lines = 24): string {
  return stripAnsi(text)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "")
    .slice(-lines)
    .join("\n")
    .slice(0, 4000);
}
