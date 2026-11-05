// `/solo` per project: `su-code/ship/solo/SOLO.md` + `su-code/ship/ACTIVE` (lib/solo.ts parses them).
// Read by the office poll (the question pinned on every tab) and the "Vòng lặp" tab. Never throws.
import fs from "node:fs";
import path from "node:path";
import { parseSoloMd, soloActive, soloState, type Solo, type SoloStatus } from "../solo";

/** SOLO.md's log only grows: its header is at the top, the newest lines at the end. */
const HEAD_BYTES = 8 * 1024;
const TAIL_BYTES = 32 * 1024;

export type ProjectSolo = { root: string; name: string; state: SoloStatus; active: boolean; solo: Solo | null };

function readPart(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const size = fs.fstatSync(fd).size;
    if (size <= HEAD_BYTES + TAIL_BYTES) {
      const buf = Buffer.alloc(size);
      return buf.subarray(0, fs.readSync(fd, buf, 0, size, 0)).toString("utf8");
    }
    const head = Buffer.alloc(HEAD_BYTES);
    const tail = Buffer.alloc(TAIL_BYTES);
    const h = head.subarray(0, fs.readSync(fd, head, 0, HEAD_BYTES, 0)).toString("utf8");
    const t = tail.subarray(0, fs.readSync(fd, tail, 0, TAIL_BYTES, size - TAIL_BYTES)).toString("utf8");
    // The header ends at the first blank line; the tail starts mid-line, so its first line is dropped.
    const end = h.search(/\r?\n\s*\r?\n/);
    return `${end >= 0 ? h.slice(0, end) : h}\n\n${t.slice(t.indexOf("\n") + 1)}`;
  } catch {
    return null;
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

/** One project's /solo; null when it never ran there (no SOLO.md and not in ACTIVE). */
export function readSolo(root: string, name = path.basename(root)): ProjectSolo | null {
  const ship = path.join(root, "su-code", "ship");
  const md = readPart(path.join(ship, "solo", "SOLO.md"));
  let active = false;
  try {
    active = soloActive(fs.readFileSync(path.join(ship, "ACTIVE"), "utf8").slice(0, 16 * 1024));
  } catch {
    /* no ACTIVE: nothing registered */
  }
  const solo = md == null ? null : parseSoloMd(md);
  if (!solo && !active) return null;
  return { root, name, state: soloState(solo, active), active, solo };
}
