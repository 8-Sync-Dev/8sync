// `pnpm dev` / `pnpm start` on every OS: Next on 127.0.0.1, port from PORT, else HQ_UI_PORT, else 8740.
// The scripts used `${PORT:-${HQ_UI_PORT:-8740}}`, which only a POSIX shell expands; pnpm runs scripts
// through cmd.exe on Windows, so `next` got that text as its port and would not start.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const HOST = "127.0.0.1";
export const DEFAULT_PORT = 8740;

/**
 * The port to listen on. An empty variable counts as unset (as `${VAR:-}` does); anything that is not
 * a port number is an error rather than a quiet fallback to another port.
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function port(env) {
  for (const name of ["PORT", "HQ_UI_PORT"]) {
    const raw = env[name]?.trim();
    if (!raw) continue;
    const n = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
    if (!(n >= 1 && n <= 65535)) throw new Error(`${name}=${JSON.stringify(env[name])} is not a port (1-65535)`);
    return n;
  }
  return DEFAULT_PORT;
}

/**
 * Next's arguments for `mode` (`dev` | `start`).
 * @param {string} mode
 * @param {number} p
 * @returns {string[]}
 */
export function nextArgs(mode, p) {
  if (mode !== "dev" && mode !== "start") throw new Error(`usage: node scripts/next.mjs <dev|start> (got ${JSON.stringify(mode)})`);
  return [mode, "-H", HOST, "-p", String(p)];
}

function main() {
  let args;
  try {
    args = nextArgs(process.argv[2] ?? "", port(process.env));
  } catch (e) {
    console.error(String(/** @type {Error} */ (e).message));
    process.exit(2);
  }
  // Next's own CLI, run by this node: no shell, the same on Windows, macOS and Linux.
  const bin = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const child = spawn(process.execPath, [bin, ...args], { stdio: "inherit" });
  for (const sig of /** @type {const} */ (["SIGINT", "SIGTERM"])) process.on(sig, () => child.kill(sig));
  child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
