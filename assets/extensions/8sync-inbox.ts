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
//
// A "/command" goes through omp's own input box instead: `sendUserMessage` skips every command
// (built-ins like /model and /settings, command files, /skill:<name>), so the model would get the
// text. The box is reached through the TUI a zero-line widget is handed once; the owner's draft is
// put back after. No UI, or the box is not the focus (a picker is open) → sent as a message.
//
// At session start the session's own commands (`getCommands()`: /skill:<name>, plugin, MCP-prompt
// and extension commands) go to `<state>/hq/omp-commands.json` for HQ's "/" list.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOM_ID = /^omp-[0-9a-f]{16}$/;
const TICK_MS = 5_000;
const RUN_TIMEOUT_MS = 5_000;

/** The text is one slash command: "/" then a name, as omp parses it. */
export function isSlashCommand(text: string): boolean {
  return /^\/[A-Za-z0-9][\w.:-]*(?:\s|$)/.test(text.trim());
}

/** The session's commands as HQ reads them: name + one-line description. */
export function commandsJson(list: readonly { name: string; description?: string }[]): string {
  const commands = list.map((c) => ({ name: c.name, description: (c.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160) }));
  return JSON.stringify({ commands });
}

/** What the extension needs of omp's input box (pi-tui `Editor`). */
type Box = { getText(): string; submit(): void };
type Focus = { getFocused(): unknown };

function asBox(v: unknown): Box | null {
  if (v === null || typeof v !== "object" || !("getText" in v) || !("submit" in v)) return null;
  return typeof v.getText === "function" && typeof v.submit === "function" ? (v as Box) : null;
}

/**
 * Run `text` as if typed into omp's input box and Enter pressed. False (nothing changed) when there
 * is no UI, the box is not focused, or it would not submit.
 */
function submitTyped(ctx: ExtensionContext, tui: Focus | null, text: string): boolean {
  if (!ctx.hasUI || tui === null) return false;
  const box = asBox(tui.getFocused());
  if (box === null) return false;
  const draft = ctx.ui.getEditorText();
  const cmd = text.trim();
  ctx.ui.setEditorText(cmd);
  if (box.getText() !== cmd) {
    ctx.ui.setEditorText(draft);
    return false;
  }
  box.submit();
  const sent = box.getText() !== cmd;
  // Sent: the box is empty, put the draft back. Not sent: take the command out again.
  if (draft !== "" || !sent) ctx.ui.setEditorText(draft);
  return sent;
}

/**
 * The pending delivery from `{"text": string|null, "messages"?: string[]}`: the framed prompt and
 * the messages one by one (an older 8sync sends no `messages`); null when there is none or the
 * output is not that.
 */
export function parseInbox(stdout: string | null): { text: string; messages: string[] } | null {
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
  if (typeof t !== "string" || t.trim() === "") return null;
  const m = "messages" in v && Array.isArray(v.messages) ? v.messages : [];
  return { text: t, messages: m.filter((x): x is string => typeof x === "string") };
}

/** Messages that are all "/commands" run typed, one by one; anything else enters as the framed prompt. */
export function deliver(got: { text: string; messages: string[] }, typed: (cmd: string) => boolean, send: (text: string) => void): void {
  if (got.messages.length === 0 || !got.messages.every(isSlashCommand)) return send(got.text);
  const left = got.messages.filter((m) => !typed(m));
  if (left.length === got.messages.length) return send(got.text);
  for (const m of left) send(m);
}

/** HQ's composer switch (apps/hq-ui/lib/room-model.ts `ompControl`, same prefix): `/8sync-model {"model"?, "thinking"?}`. */
export const MODEL_CONTROL = "/8sync-model";
const THINKING = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
export type ModelControl = { model?: string; thinking?: string };

/** The switch a message asks for; null when it is not one (then it is delivered like any message). */
export function parseModelControl(text: string): ModelControl | null {
  const s = text.trim();
  if (!s.startsWith(`${MODEL_CONTROL} `)) return null;
  let v: unknown;
  try {
    v = JSON.parse(s.slice(MODEL_CONTROL.length + 1));
  } catch {
    return null;
  }
  if (v === null || typeof v !== "object") return null;
  const c: ModelControl = {};
  if ("model" in v && typeof v.model === "string" && /^[^/\s:]+\/[^\s:]+$/.test(v.model)) c.model = v.model;
  if ("thinking" in v && typeof v.thinking === "string" && THINKING.has(v.thinking)) c.thinking = v.thinking;
  return c.model || c.thinking ? c : null;
}

/** Switches apart from the rest; `rest` null = nothing left to deliver, else the delivery without them. */
export function splitControls(got: { text: string; messages: string[] }): { controls: ModelControl[]; rest: { text: string; messages: string[] } | null } {
  const parsed = got.messages.map(parseModelControl);
  const controls = parsed.filter((c): c is ModelControl => c !== null);
  if (controls.length === 0) return { controls, rest: got };
  const left = got.messages.filter((_, i) => parsed[i] === null);
  // The framed prompt quotes every message, the switch too: what is left goes out as itself.
  return { controls, rest: left.length === 0 ? null : { text: left.join("\n\n"), messages: left } };
}

/** What `<state>/omp-model/<id>.json` holds: HQ shows it on the room and preselects the picker. */
export function modelStateJson(s: { model: string | null; thinking: string | null; error: string | null }, at: number): string {
  return JSON.stringify({ model: s.model, thinking: s.thinking, error: s.error, at });
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
  const st = { inflight: false, empty: 0, tick: 0, model: "", error: null as string | null };
  const stateDir = path.join(os.homedir(), ".local", "state", "8sync", "hq");
  let tui: Focus | null = null;

  /** Writes what the session runs now when it changed (also after a switch typed in omp itself). */
  function writeModel(ctx: ExtensionContext): void {
    const m = ctx.model;
    const s = { model: m ? `${m.provider}/${m.id}` : null, thinking: pi.getThinkingLevel() ?? null, error: st.error };
    const key = JSON.stringify(s);
    if (key === st.model) return;
    try {
      const dir = path.join(stateDir, "omp-model");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${id}.json`), modelStateJson(s, Date.now()));
      st.model = key;
    } catch {
      // written again on the next tick
    }
  }

  /** This session only (omp's config is not touched); an unknown model or one without a key is reported, not applied. */
  async function applyModel(ctx: ExtensionContext, c: ModelControl): Promise<void> {
    st.error = null;
    if (c.model) {
      const at = c.model.indexOf("/");
      const model = ctx.modelRegistry.find(c.model.slice(0, at), c.model.slice(at + 1));
      if (!model) st.error = `omp không có model ${c.model}`;
      else if (!(await pi.setModel(model))) st.error = `chưa có key hoặc đăng nhập cho ${c.model}`;
    }
    if (c.thinking) pi.setThinkingLevel(c.thinking as Parameters<ExtensionAPI["setThinkingLevel"]>[0]);
    writeModel(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    if (isSub(ctx)) return;
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, "omp-commands.json"), commandsJson(pi.getCommands()));
    } catch {
      // HQ's list keeps the last one written
    }
    if (ctx.hasUI) {
      // A widget factory is handed the TUI; drop the zero-line widget at once.
      ctx.ui.setWidget("8sync-inbox", (t) => {
        if ("getFocused" in t && typeof t.getFocused === "function") tui = t;
        return { render: () => [] };
      });
      ctx.ui.setWidget("8sync-inbox", undefined);
    }
    writeModel(ctx);
    ctx.setInterval(async () => {
      st.tick += 1;
      writeModel(ctx);
      if (st.inflight || st.tick % pollEvery(st.empty) !== 0) return;
      st.inflight = true;
      try {
        const got = parseInbox(await run(id, ctx.cwd, []));
        if (got === null) {
          st.empty += 1;
          return;
        }
        st.empty = 0;
        st.tick = 0;
        let entered = true;
        try {
          const { controls, rest } = splitControls(got);
          for (const c of controls) await applyModel(ctx, c);
          // No `deliverAs`: idle → a new prompt; working → a steer, taken after the running tool.
          if (rest !== null) deliver(rest, (cmd) => submitTyped(ctx, tui, cmd), (text) => pi.sendUserMessage(text));
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
