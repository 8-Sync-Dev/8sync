// Permission requests a room posts while the owner is away (`8sync ccc hook permit`, Rust
// crates/cli/src/verbs/ccc/permit.rs): `<session>.ask.json` waits for the owner's click here,
// which HQ writes as `<session>.answer.json`. When the wait runs out the hook goes on by itself:
// everyday work inside the project proceeds (`then: "allow"`), the rest is skipped (`why`).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `then`: what the room does if nobody clicks (null: 8sync older than 0.100.4, which always skipped);
 * `why`: the reason a step will be skipped.
 */
export type Permit = { session: string; id: string; tool: string; what: string; at: number; until: number; then: "allow" | "deny" | null; why: string | null };

const SAFE = /^[A-Za-z0-9_-]{1,64}$/;

export const permitDir = (home = os.homedir()) => path.join(home, ".local", "state", "8sync", "ccc", "permit");

function parse(text: string | null): Permit | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    const s = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : null);
    const session = s(v.session, 64);
    const id = s(v.id, 80);
    const at = n(v.at);
    const until = n(v.until);
    if (!session || !SAFE.test(session) || !id || at == null || until == null) return null;
    const then = v.then === "allow" || v.then === "deny" ? v.then : null;
    return { session, id, tool: s(v.tool, 60) ?? "tool", what: s(v.what, 400) ?? "", at, until, then, why: s(v.why, 200) };
  } catch {
    return null;
  }
}

/** Open requests (seconds in the file), newest first; ones past their deadline are left out. */
export function readPermits(now = Date.now(), dir = permitDir()): Permit[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((f) => f.endsWith(".ask.json")).slice(0, 200);
  } catch {
    return [];
  }
  const out: Permit[] = [];
  for (const f of names) {
    let text: string | null = null;
    try {
      text = fs.readFileSync(path.join(dir, f), "utf8").slice(0, 8192);
    } catch {
      /* the hook just removed it */
    }
    const p = parse(text);
    if (p && p.until * 1000 > now) out.push(p);
  }
  return out.sort((a, b) => b.at - a.at);
}

/** The owner's click: only for the request that is open right now (same session and id). */
export function answerPermit(session: string, id: string, decision: "allow" | "deny", dir = permitDir()): { ok: boolean; error?: string } {
  if (!SAFE.test(session)) return { ok: false, error: "session không hợp lệ" };
  let open: Permit | null = null;
  try {
    open = parse(fs.readFileSync(path.join(dir, `${session}.ask.json`), "utf8"));
  } catch {
    /* gone */
  }
  if (!open || open.id !== id) return { ok: false, error: "yêu cầu này đã hết hạn hoặc đã được trả lời" };
  const file = path.join(dir, `${session}.answer.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ id, decision, at: Math.floor(Date.now() / 1000) }), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return { ok: true };
}
