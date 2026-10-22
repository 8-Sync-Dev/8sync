// Effects for lib/stuck-asks.ts: ask 8sync whether the critic may take a stuck question, close the
// dialog in the room's `claude attach` (Esc through the `8sync ccc term` bridge), queue the critic
// route in the room's inbox. Runs from the GET /api/auto tick, only while auto is on.
import { spawn as nodeSpawn, execFile } from "node:child_process";
import { binFor, childEnv } from "./child-env";
import fs from "node:fs";
import path from "node:path";
import { criticMessage, stuckAfterMs, stuckAsks } from "../stuck-asks";
import { focusRests, inAutoScope } from "../auto";
import { repoOf } from "../sidebar";
import { lastAutoStatus, type AutoStatus } from "./auto";
import { getDb } from "./db";
import { isSessionId, queueInbox } from "./inbox";
import { loadOffice } from "./office";
import { stateDir } from "./paths";
import { termArgs } from "./term";

const stateFile = () => path.join(stateDir(), "stuck-asks.json");
const ATTACH_MS = 4000;
const AFTER_KEY_MS = 2500;

function readHandled(): Record<string, number> {
  try {
    const j = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(j ?? {})) if (isSessionId(k) && typeof v === "number") out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function writeHandled(h: Record<string, number>): void {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(h), { mode: 0o600 });
}

/** `8sync ccc delegate check`: may the critic take these questions in `cwd`? */
export function delegateCheck(questions: unknown, cwd: string | null): Promise<{ critic: boolean; reason: string | null }> {
  return new Promise((resolve) => {
    const child = execFile(binFor("8sync"), ["ccc", "delegate", "check", ...(cwd ? ["--cwd", cwd] : [])], { timeout: 5000, windowsHide: true, env: childEnv() }, (err, stdout) => {
      try {
        const v = err ? null : JSON.parse(String(stdout));
        resolve({ critic: v?.critic === true, reason: typeof v?.reason === "string" ? v.reason : null });
      } catch {
        resolve({ critic: false, reason: null });
      }
    });
    child.stdin?.end(JSON.stringify({ questions }));
  });
}

/** Esc into the room's dialog through the terminal bridge, then close the bridge (the room keeps running). */
export function closeDialog(id: string, cwd: string | null, spawn = nodeSpawn): Promise<void> {
  return new Promise((resolve) => {
    const p = spawn(binFor("8sync"), termArgs(id, 120, 34), { cwd: cwd ?? undefined, windowsHide: true, env: childEnv() });
    p.stdout?.resume();
    p.stderr?.resume();
    const done = () => {
      try {
        p.kill();
      } catch {
        /* gone */
      }
      resolve();
    };
    p.on("error", done);
    setTimeout(() => {
      p.stdin?.write(`${JSON.stringify({ i: "\u001b" })}\n`);
      setTimeout(() => {
        p.stdin?.end();
        setTimeout(done, 500);
      }, AFTER_KEY_MS);
    }, ATTACH_MS);
  });
}

let inflight: Promise<string[]> | null = null;

/** One sweep at a time: the office tab and the ask panel both poll GET /api/auto. */
/**
 * Only the rooms auto drives (same rule as auto-tick: in scope, not pinned away) — the critic
 * never mails or closes dialogs in rooms of projects outside `8sync ccc auto` (owner 2026-10-22:
 * "không gửi nhầm inbox các dự án không phải chế độ auto").
 */
export function sweepStuckAsks(status: AutoStatus, now = Date.now()): Promise<string[]> {
  if (!status.on || status.paused || status.gate) return Promise.resolve([]);
  inflight ??= sweep(now, status)
    .catch(() => [] as string[])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** A room's project root, worktrees folded to their repo (as auto-tick's roomRepo). */
function roomRepo(r: { project?: { root: string } | null; cwd?: string | null }): string {
  return repoOf(r.project?.root ?? r.cwd ?? "").root;
}

/** Pure: the rooms the sweep may touch — auto scope and not focus-resting. */
export function scopedFor<T extends { project?: { root: string } | null; cwd?: string | null }>(status: Pick<AutoStatus, "repos" | "out" | "focus" | "pins">, rooms: T[]): T[] {
  return rooms.filter((r) => inAutoScope(status, roomRepo(r)) && !focusRests(status, roomRepo(r)));
}

async function sweep(now: number, status: AutoStatus): Promise<string[]> {
  const office = await loadOffice(getDb(), now);
  const handled = readHandled();
  const stuck = stuckAsks(scopedFor(lastAutoStatus() ?? status, office.rooms), handled, now, stuckAfterMs(lastAutoStatus()?.after_s));
  const done: string[] = [];
  for (const r of stuck) {
    const sid = r.session_id!;
    const ask = r.ask;
    // The id goes on a command line: the UUID alphabet only, never something read as a flag.
    if (!isSessionId(sid) || !ask || ask.kind !== "question" || ask.at == null) continue;
    handled[sid] = ask.at;
    const c = await delegateCheck(ask.questions, r.cwd);
    if (!c.critic || !c.reason) continue;
    // Queue first: the inbox mod delivers it as soon as the closed dialog leaves the room idle.
    queueInbox(sid, criticMessage(ask, c.reason), now);
    await closeDialog(sid, r.cwd);
    done.push(r.label ?? sid.slice(0, 8));
  }
  // Forget rooms that no longer ask.
  for (const k of Object.keys(handled)) if (!office.rooms.some((r) => r.session_id === k && r.ask)) delete handled[k];
  writeHandled(handled);
  return done;
}
