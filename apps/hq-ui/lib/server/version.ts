// Running UI version vs. installed 8sync binary: a started `8sync hq ui` keeps the UI it launched
// with, so after `8sync up` the page would otherwise look unchanged with no hint why.
import fs from "node:fs";
import path from "node:path";
import { run } from "./proc";

export type Versions = { ui: string | null; binary: string | null };

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** The installed asset layout is `<ver>/VERSION` next to `<ver>/hq-ui` (cwd); a dev checkout has none. */
export function uiVersion(cwd = process.cwd()): string | null {
  try {
    const v = fs.readFileSync(path.join(cwd, "..", "VERSION"), "utf8").trim();
    return SEMVER.test(v) ? v : null;
  } catch {
    return null;
  }
}

/** `8sync --version` → "8sync 0.94.0" → "0.94.0"; null for junk or no binary. */
export function parseBinaryVersion(stdout: string): string | null {
  const last = stdout.trim().split(/\s+/).pop() ?? "";
  const v = last.replace(/^v/, "");
  return SEMVER.test(v) ? v : null;
}

let cache: { at: number; v: string | null } | null = null;
const TTL_MS = 60_000;

export async function binaryVersion(): Promise<string | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.v;
  const r = await run("8sync", ["--version"], 3000);
  const v = r.ok ? parseBinaryVersion(r.stdout) : null;
  cache = { at: Date.now(), v };
  return v;
}

export async function versions(): Promise<Versions> {
  return { ui: uiVersion(), binary: await binaryVersion() };
}
