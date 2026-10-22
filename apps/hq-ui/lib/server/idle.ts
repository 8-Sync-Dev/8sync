// Reads the "không ai rảnh" status files (`8sync ccc hook idle`). Missing dir, unreadable or bad
// JSON files are skipped; never throws. A record older than IDLE_STALE_MS (6 h) without `noTick` is
// deleted on read: the hook rewrites a member's file on its next event, so nothing live is lost while
// dead teams' leftovers stop piling up (owner 2026-10-22: "83 trạng thái team cũ" never shrank). A
// `noTick` record is never pruned here: auto-tick owns its lifecycle (`cron` expires after 35 min,
// `events` holds as long as the room exists — lib/server/auto-tick.ts). Tested in tests/idle.test.ts.
import fs from "node:fs";
import path from "node:path";
import { isStale, parseIdleRecord, type IdleRecord } from "../idle";
import { idleStatusDir } from "./paths";

const MAX_FILES = 400;

export function readIdleStatus(dir = idleStatusDir()): IdleRecord[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = new Map<string, IdleRecord>();
  for (const n of names.filter((x) => x.endsWith(".json")).slice(0, MAX_FILES)) {
    let r: IdleRecord | null = null;
    let f: string;
    try {
      f = path.join(dir, n);
      if (fs.statSync(f).size > 16_384) continue;
      r = parseIdleRecord(JSON.parse(fs.readFileSync(f, "utf8")));
    } catch {
      continue;
    }
    if (!r) continue;
    // Dead members' leftovers: prune instead of keeping them forever (auto-tick's `noTick` flags
    // are exempt — they are its contract, not junk).
    if (!r.noTick && isStale(r)) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        /* a file that will not delete just stays */
      }
      continue;
    }
    // One record per member; the newest wins if two files claim the same one.
    const k = `${r.team}\u0000${r.name}`;
    const prev = out.get(k);
    if (!prev || prev.ts < r.ts) out.set(k, r);
  }
  return [...out.values()].sort((a, b) => b.ts - a.ts);
}
