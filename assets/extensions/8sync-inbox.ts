// 8sync-inbox (omp): the owner's messages from 8 Sync HQ reach this omp session right away.
//
// HQ cannot type into an omp session it did not start, so a message from the room's composer
// (Tổng quan, Chat phòng) is queued in the room's inbox, `<state>/hq/inbox/<room id>.jsonl`. The
// room id is `EIGHTSYNC_ROOM_ID`, exported by every omp launch 8sync makes (`8sync .`, HQ's host,
// `ccc term --omp-new`). Claude Code has the `8sync-inbox` mod + Stop hook for this; omp had no
// reader, so a message to an omp room was never delivered.
//
// Every poll runs `8sync ccc inbox --session <id> --json`, which CLAIMS the pending messages (and
// touches `<id>.live`, so HQ shows "nhận ngay"). The text enters as the owner's message: idle, it
// starts a turn; working, it is a steer, taken as soon as the running tool returns, like typing
// into omp mid-turn. Then `--ack` drops the claim; when delivery throws,
// `--release` hands it back. A claim nobody settles (killed process) is served again after two
// minutes, so a message is never lost and is delivered once.
//
// Polling: every 5 s for the first minute of quiet, then 15 s, then 30 s; a delivery starts over.
// Main agent only (subagents share the env, they must not take the owner's messages).
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { execFile } from "node:child_process";

const ROOM_ID = /^omp-[0-9a-f]{16}$/;
const TICK_MS = 5_000;
const RUN_TIMEOUT_MS = 5_000;

/** The pending text from `{"text": string|null}`; null when there is none or the output is not that. */
export function parseInbox(stdout: string | null): string | null {
  const s = (stdout ?? "").trim();
  if (!s.startsWith("{")) return null;
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object" || !("text" in v)) return null;
  const t = v.text;
  return typeof t === "string" && t.trim() !== "" ? t : null;
}

/** Poll on every n-th 5 s tick after `empty` empty polls: 5 s for a minute, then 15 s, then 30 s. */
export function pollEvery(empty: number): number {
  if (empty < 12) return 1;
  if (empty < 24) return 3;
  return 6;
}

function run(id: string, cwd: string, args: string[]): Promise<string | null> {
  // Executor form: the extensions' lib is es2023 (no `Promise.withResolvers`).
  return new Promise((resolve) => {
    execFile("8sync", ["ccc", "inbox", "--session", id, ...args, "--json"], { cwd, timeout: RUN_TIMEOUT_MS, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

/** A subagent's context (`ctx.agent.kind === "sub"`; the pinned typings predate `agent`). */
function isSub(ctx: object): boolean {
  if (!("agent" in ctx)) return false;
  const a = ctx.agent;
  return a !== null && typeof a === "object" && "kind" in a && a.kind === "sub";
}

export default function (pi: ExtensionAPI) {
  const id = process.env.EIGHTSYNC_ROOM_ID ?? "";
  if (!ROOM_ID.test(id)) return;
  const st = { inflight: false, empty: 0, tick: 0 };

  pi.on("session_start", async (_event, ctx) => {
    if (isSub(ctx)) return;
    ctx.setInterval(async () => {
      st.tick += 1;
      if (st.inflight || st.tick % pollEvery(st.empty) !== 0) return;
      st.inflight = true;
      try {
        const text = parseInbox(await run(id, ctx.cwd, []));
        if (text === null) {
          st.empty += 1;
          return;
        }
        st.empty = 0;
        st.tick = 0;
        let entered = true;
        try {
          // No `deliverAs`: idle → a new prompt; working → a steer, taken after the running tool.
          pi.sendUserMessage(text);
        } catch {
          entered = false;
        }
        await run(id, ctx.cwd, [entered ? "--ack" : "--release"]);
      } catch {
        // a failed poll is retried on the next tick
      } finally {
        st.inflight = false;
      }
    }, TICK_MS);
  });
}
