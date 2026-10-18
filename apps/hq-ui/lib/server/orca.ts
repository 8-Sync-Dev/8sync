// "Mở trong Orca": a room's `claude attach` opens as a tab of the owner's Orca (github.com/stablyai/orca)
// in the room's own worktree, via Orca's CLI (`orca terminal create --worktree path:<dir> --command …`).
// argv only, no shell; the id is 8 hex chars and the tab title is cut to plain characters first.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { mainRoot } from "../preview";

const SHORT_ID = /^[0-9a-f]{8}$/i;
const TIMEOUT_MS = 20_000;

type Env = Record<string, string | undefined>;

function onPath(name: string, env: Env, platform: NodeJS.Platform, exists: (p: string) => boolean): string | null {
  const p = platform === "win32" ? path.win32 : path.posix;
  for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    const full = p.join(dir, name);
    if (exists(full)) return full;
  }
  return null;
}

/**
 * The Orca CLI on this machine, or null. Order: `ORCA_CLI_COMMAND` (Orca sets it in its WSL sessions),
 * the CLI bundled with the desktop app, then PATH. On Linux only `orca-ide`: a bare `orca` there is
 * usually the GNOME screen reader and would start speaking.
 */
export function orcaBin(env: Env = process.env, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = fs.existsSync): string | null {
  const own = env.ORCA_CLI_COMMAND?.trim();
  if (own && path.isAbsolute(own) && exists(own)) return own;
  if (platform === "win32") {
    const bundled = env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, "Programs", "orca", "resources", "bin", "orca.exe") : null;
    if (bundled && exists(bundled)) return bundled;
    return onPath("orca.exe", env, platform, exists);
  }
  if (platform === "darwin") {
    const bundled = "/Applications/Orca.app/Contents/Resources/bin/orca";
    if (exists(bundled)) return bundled;
    return onPath("orca", env, platform, exists);
  }
  return onPath("orca-ide", env, platform, exists);
}

/** Tab title: letters, digits, space, `._-` only, at most 40. */
export const orcaTitle = (s: string) => s.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 40) || "8sync";

/** A plain shell tab in that folder. No `--command`: Orca takes a `claude …` command for an agent launch and times out waiting for it. */
export function orcaArgs(dir: string, title: string): string[] {
  return ["terminal", "create", "--worktree", `path:${dir.replace(/\\/g, "/")}`, "--title", orcaTitle(title), "--json"];
}

/** Then the attach line is typed into that tab, with Enter. */
export function orcaSendArgs(handle: string, shortId: string): string[] {
  if (!SHORT_ID.test(shortId)) throw new Error("bad session id");
  return ["terminal", "send", "--terminal", handle, "--text", `claude attach ${shortId}`, "--enter", "--json"];
}

/** The line the page offers to copy: go to the room's folder, then attach (`;` works in bash and PowerShell). */
export function attachLine(cwd: string | null | undefined, shortId: string): string {
  const attach = `claude attach ${shortId.slice(0, 8)}`;
  return cwd && !/["\r\n`$]/.test(cwd) ? `cd "${cwd}"; ${attach}` : attach;
}

export type Run = (bin: string, args: string[]) => Promise<string>;

const run: Run = (bin, args) =>
  new Promise((resolve) => {
    // Orca prints its JSON answer on stdout whether it worked or not; the exit code adds nothing.
    execFile(bin, args, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (_err, stdout) => resolve(String(stdout ?? "")));
  });

export type OrcaResult = { ok: true; dir: string } | { ok: false; error: string };

type Answer = { ok?: boolean; error?: { code?: string; message?: string }; result?: { terminal?: { handle?: string } } };

async function ask(exec: Run, bin: string, args: string[]): Promise<Answer | null> {
  try {
    return JSON.parse(await exec(bin, args)) as Answer;
  } catch {
    return null;
  }
}

/**
 * Open the attach in Orca: a shell tab in the room's folder (its repo root only when Orca does not
 * know the folder; any other failure may still have made a tab, a second try would make two), type
 * `claude attach <id>` into it, then bring it forward. No `--focus` on create: Orca times out with it
 * when that worktree is not the open one; `terminal switch` does the same job afterwards.
 */
export async function openInOrca(cwd: string, title: string, shortId: string, bin: string | null = orcaBin(), exec: Run = run): Promise<OrcaResult> {
  if (!SHORT_ID.test(shortId)) return { ok: false, error: "bad session id" };
  if (!bin) return { ok: false, error: "Orca chưa cài trên máy này" };
  const dirs = [...new Set([cwd, mainRoot(cwd)])];
  for (const dir of dirs) {
    const out = await ask(exec, bin, orcaArgs(dir, title));
    if (out?.ok) {
      const handle = out.result?.terminal?.handle;
      if (!handle || !/^[\w-]{1,80}$/.test(handle)) return { ok: false, error: "Orca mở tab nhưng không trả handle" };
      const sent = await ask(exec, bin, orcaSendArgs(handle, shortId));
      if (!sent?.ok) return { ok: false, error: `Đã mở tab trong Orca nhưng chưa gõ được lệnh: ${sent?.error?.message ?? "không rõ"}` };
      await ask(exec, bin, ["terminal", "switch", "--terminal", handle, "--json"]);
      return { ok: true, dir };
    }
    if (out?.error?.code !== "selector_not_found") return { ok: false, error: out?.error?.message ?? "Orca không trả lời" };
  }
  return { ok: false, error: "Orca chưa có repo này (orca repo add <thư mục>)" };
}
