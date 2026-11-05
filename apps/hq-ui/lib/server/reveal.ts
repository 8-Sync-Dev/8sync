// "Mở thư mục": show a file in the OS file manager of the machine running HQ (Explorer with the file
// selected, Finder revealing it, the folder on Linux). Only a file HQ already knows about: a registered
// artifact by id, or a path whose real location sits inside a project HQ knows (the same roots artifact
// registration takes) and outside `.git`/`.ssh`/`node_modules`/secret-looking names.
// argv only, no shell; the path handed to the OS is the realpath, so it can never start with a switch.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { allowedUnder, inside, isArtifactId, realOrNull, resolveArtifact } from "./artifacts";
import { childEnv } from "./child-env";

export const REVEAL_PATH_MAX = 4096;

export type RevealInput = { id?: unknown; path?: unknown; base?: unknown };
export type RevealTarget = { ok: true; target: string; dir: boolean } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): RevealTarget => ({ ok: false, status, error });

/** What `input` names, checked against `roots` (lib/server/in-view knownRoots). */
export function revealTarget(db: DatabaseSync, input: RevealInput, roots: string[]): RevealTarget {
  if (input.id !== undefined) {
    if (!isArtifactId(input.id)) return fail(422, "id: 32 ký tự hex");
    const hit = resolveArtifact(db, input.id);
    return hit ? { ok: true, target: hit.file.path, dir: false } : fail(404, "không thấy file của kết quả này");
  }
  const p = input.path;
  if (typeof p !== "string" || !p.trim() || p.length > REVEAL_PATH_MAX || p.includes("\0")) return fail(422, "path: đường dẫn tới file");
  let given = p.trim();
  if (!path.isAbsolute(given)) {
    const b = input.base;
    if (typeof b !== "string" || !path.isAbsolute(b) || b.length > REVEAL_PATH_MAX || b.includes("\0")) return fail(422, "path tương đối cần base là thư mục tuyệt đối");
    given = path.resolve(b, given);
  }
  const real = realOrNull(given);
  if (!real) return fail(404, "không thấy file");
  const root = roots
    .map(realOrNull)
    .filter((r): r is string => !!r && inside(real, r))
    .sort((a, b) => b.length - a.length)[0];
  if (!root || !allowedUnder(real, root)) return fail(403, "file không nằm trong dự án nào HQ đang biết");
  let st: fs.Stats;
  try {
    st = fs.statSync(real);
  } catch {
    return fail(404, "không thấy file");
  }
  return { ok: true, target: real, dir: st.isDirectory() };
}

export type RevealCommand = { cmd: string; args: string[]; verbatim: boolean };

/**
 * How this platform shows `target` (a real absolute path) in its file manager. Windows and macOS always
 * reveal (select it in its parent), never open: `explorer <file>` would run it and `open X.app` would
 * launch a bundle, even if a folder was swapped for one after the check. Linux opens the folder itself
 * (`xdg-open` on a directory starts the file manager) or the file's folder.
 */
export function revealCommand(platform: NodeJS.Platform, target: string, dir: boolean, env: Record<string, string | undefined> = process.env): RevealCommand {
  if (platform === "win32") {
    // `/select,"<path>"` is the form Explorer documents; a Windows path cannot hold `"`, so the quoting is exact.
    const explorer = path.win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "explorer.exe");
    return { cmd: explorer, args: [`/select,"${target}"`], verbatim: true };
  }
  if (platform === "darwin") return { cmd: "/usr/bin/open", args: ["-R", target], verbatim: false };
  return { cmd: "xdg-open", args: [dir ? target : path.dirname(target)], verbatim: false };
}

/** Starts the file manager; resolves false when it could not be started. */
export function reveal(target: string, dir: boolean, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const c = revealCommand(platform, target, dir);
  if (platform === "win32" && target.includes('"')) return Promise.resolve(false);
  const { promise, resolve } = Promise.withResolvers<boolean>();
  try {
    const child = spawn(c.cmd, c.args, { detached: true, stdio: "ignore", shell: false, windowsVerbatimArguments: c.verbatim, windowsHide: false, env: childEnv() });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  } catch {
    resolve(false);
  }
  return promise;
}
