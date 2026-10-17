// "Mở terminal để trả lời": opens a terminal window on the machine running HQ with
// `claude attach <id>`, the only way Claude Code offers to answer a background session's question.
// argv only (no shell string is built from input); the id is checked to be 8 hex chars first.
import { spawn } from "node:child_process";

const SHORT_ID = /^[0-9a-f]{8}$/i;

export type Launch = { cmd: string; args: string[]; verbatim?: boolean };

/** Terminal launchers to try in order for this platform. */
export function terminalLaunchers(platform: NodeJS.Platform, shortId: string): Launch[] {
  if (!SHORT_ID.test(shortId)) return [];
  const attach = ["claude", "attach", shortId];
  if (platform === "win32") {
    // `start ""` opens a new console window (Windows Terminal when it is the default); /k keeps it
    // open after claude exits so an error stays readable. Verbatim: cmd parses its own line.
    return [{ cmd: "cmd.exe", args: ["/d", "/c", "start", '""', "cmd.exe", "/k", ...attach], verbatim: true }];
  }
  if (platform === "darwin") {
    return [{ cmd: "osascript", args: ["-e", `tell application "Terminal" to do script "${attach.join(" ")}"`, "-e", 'tell application "Terminal" to activate'] }];
  }
  return [
    { cmd: "x-terminal-emulator", args: ["-e", ...attach] },
    { cmd: "gnome-terminal", args: ["--", ...attach] },
    { cmd: "konsole", args: ["-e", ...attach] },
    { cmd: "kitty", args: attach },
    { cmd: "alacritty", args: ["-e", ...attach] },
    { cmd: "xterm", args: ["-e", ...attach] },
  ];
}

function tryLaunch(l: Launch): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(l.cmd, l.args, { detached: true, stdio: "ignore", windowsVerbatimArguments: l.verbatim, windowsHide: false });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

/** The launcher that started, or null when none exists here (the page then offers the command to copy). */
export async function openAttachTerminal(shortId: string, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  for (const l of terminalLaunchers(platform, shortId)) if (await tryLaunch(l)) return l.cmd;
  return null;
}
