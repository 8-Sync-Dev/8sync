// "Kết quả" of a room: its Nhật ký folded into turns. A turn starts at a prompt (the owner, a channel
// or HQ's inbox frame) and its output is the last reply text before the next prompt: what the agent
// handed back. Pure, shared by the server (activity route) and the room view.
import type { ActivityEvent } from "./server/activity";

export type Turn = {
  /** Stable across polls while the turn is in the transcript tail: its prompt's time and length. */
  key: string;
  at: number | null;
  /** null: the tail starts inside a turn whose prompt fell off it. */
  prompt: string | null;
  output: string | null;
  outputAt: number | null;
  /** Tool calls and subagents started in the turn; failed tool calls. */
  steps: number;
  agents: number;
  errors: number;
  /** The newest turn while it may still be working: a tool is pending or no reply came after the last step. */
  live: boolean;
};

/** Turns kept per room (newest last): the view's table of contents and preview. */
export const TURNS_MAX = 20;

export function turnsFrom(events: readonly ActivityEvent[], max = TURNS_MAX): Turn[] {
  const out: Turn[] = [];
  let cur: Turn | null = null;
  let tail: ActivityEvent["kind"] | null = null;
  let pending = 0;
  for (const ev of events) {
    if (ev.kind === "prompt" || !cur) {
      cur = {
        key: ev.kind === "prompt" ? `${ev.at ?? 0}:${ev.text.length}` : `head:${ev.at ?? 0}`,
        at: ev.at,
        prompt: ev.kind === "prompt" ? ev.text : null,
        output: null,
        outputAt: null,
        steps: 0,
        agents: 0,
        errors: 0,
        live: false,
      };
      out.push(cur);
      pending = 0;
      tail = null;
      if (ev.kind === "prompt") continue;
    }
    tail = ev.kind;
    if (ev.kind === "text") {
      cur.output = ev.text;
      cur.outputAt = ev.at;
    } else {
      cur.steps++;
      if (ev.kind === "agent") cur.agents++;
      if (ev.status === "error") cur.errors++;
      if (ev.status === "pending") pending++;
    }
  }
  if (cur) cur.live = pending > 0 || tail !== "text";
  return out.slice(-max);
}

const FRAME = /^8 Sync HQ: the owner sent you \d+ message\(s\)[^\n]*\n/;

/** What the owner wrote in a prompt: HQ's inbox frame dropped. */
export function promptBody(prompt: string): string {
  return prompt.replace(FRAME, "").trim();
}

/** One line naming a turn in the table of contents. */
export function turnTitle(t: Pick<Turn, "prompt">, max = 90): string {
  if (t.prompt == null) return "(đầu nhật ký)";
  const line = promptBody(t.prompt)
    .split("\n")
    .map((l) => l.replace(/^[#>*\-\s]+/, "").trim())
    .find(Boolean);
  const s = (line ?? "").replace(/\s+/g, " ");
  if (!s) return "(lời nhắn trống)";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The turn an owner message started: the first turn at or after it (one minute of clock slack) whose
 * prompt carries the message's first 80 characters. A reply from the room maps to the turn it was
 * written in: the last one that started before it.
 */
export function turnForMessage(turns: readonly Turn[], m: { kind: string; text: string | null; ts: number }): Turn | null {
  if (m.kind === "session_reply") {
    let hit: Turn | null = null;
    for (const t of turns) if (t.at != null && t.at <= m.ts + 60_000 && t.output) hit = t;
    return hit;
  }
  if (m.kind !== "owner_message" || !m.text) return null;
  // "/cmd args" reaches the room expanded (the command's body, the args inside it): match the args.
  const text = m.text.trim();
  const cmd = /^\/[\w:.-]+\s+([\s\S]+)$/.exec(text);
  const needle = norm(cmd ? cmd[1] : text).slice(0, 80);
  if (!needle) return null;
  return turns.find((t) => t.prompt != null && (t.at == null || t.at >= m.ts - 60_000) && norm(t.prompt).includes(needle)) ?? null;
}

/** Every turn's output as one markdown file: a heading per turn (its title and time), its output under it. */
export function outputsMarkdown(turns: readonly Turn[], room: string, stamp: (ms: number) => string): string {
  const parts = [`# Kết quả — ${room}`, ""];
  for (const t of turns) {
    if (!t.output) continue;
    parts.push(`## ${turnTitle(t, 120)}`, "", `_${t.at != null ? stamp(t.at) : ""}_`.replace(/^__$/, ""), "", t.output, "");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
