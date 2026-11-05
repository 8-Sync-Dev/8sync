// One temp root per `vitest run`: every mkdtempSync in tests (HOME of each file, fixture repos) lands
// under it, and it is removed when the run ends. Before this each run left ~70 dirs in %TEMP%
// (5 524 `hq-ui-test-*` on the owner's PC, 2026-11-04), and fixture repos with a `.git` showed up in
// HQ's "Dự án trên máy". Workers are forks started after this, so they inherit the env below;
// os.tmpdir() reads TMPDIR on POSIX and TEMP/TMP on Windows.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export default function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hq-ui-run-"));
  for (const k of ["TMPDIR", "TEMP", "TMP"]) process.env[k] = root;
  return () => {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch (e) {
      // A file a worker still holds (SQLite on Windows) must not fail the run.
      console.warn(`[vitest] temp root left behind: ${root} (${(e as Error).message})`);
    }
  };
}
