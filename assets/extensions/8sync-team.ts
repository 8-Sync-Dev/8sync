// 8sync-team — the omp side of 8 Sync's two teams (Claude Code rooms + omp rooms).
//
// Inert unless this omp was launched as a room by `8sync . <name>`, which sets
// `EIGHTSYNC_ROOM=<name>` and `EIGHTSYNC_ROOM_ID=<room id>`. Every policy (what is pending,
// whether a nudge is due, caps, scope) lives in the `8sync` binary; this file only carries
// its answers into the session:
//   1. inbox  — while idle, `8sync ccc inbox --session <id> --json` claims what the owner (HQ)
//      or another room queued for this room; it starts a turn (see `send`), then `--ack`
//      (`--release` when it could not be sent, so nothing is lost or delivered twice).
//      Every 5 s for the first minute of quiet, then 15 s, then 30 s.
//   2. nudge  — 30 s after a turn ends with the room still idle (then every 5 min while it stays
//      idle), `8sync ccc auto nudge` may hand it the next queued target.
//   3. resume — a turn that died on a rate-limit / overload / quota error is resumed with
//      `[8sync:resume]` after 60 s·2^n (cap 15 min, at most 5 in a row).
//   4. ask    — while the owner is away (auto on with the omp team) the `ask` tool is refused
//      with instructions to decide by risk and log the decision instead of waiting.
// 2–4 run only when `8sync ccc auto status --json` says on, not paused, "omp" in `teams`, and
// this cwd is in the auto scope (`repos`, else `repo`). They are OFF when the session model's
// provider is `anthropic` or unknown: a Claude subscription stays in Claude Code, never automated
// from omp; then the inbox claims only the owner's own messages (`--owner-only`).
// Every session that loads this file (room or not, subagents too) is refused tool calls that
// touch 8sync's control files (HQ inbox/token/secrets, permits, grants) — see `guardHit`.
// `8sync` is `$EIGHTSYNC_BIN` (set by `8sync . <name>`), never a PATH/cwd lookup when set.
// Subagent sessions rebind this factory too; automation skips them (the room is the main session).
import { execFile } from "node:child_process";

// Minimal local shapes of the omp extension API (no package type imports).
interface Msg {
  role?: string;
  stopReason?: string;
  errorMessage?: string;
  content?: unknown;
}
interface Ctx {
  cwd: string;
  hasUI: boolean;
  model?: { provider?: string } | null;
  agent?: { kind?: string };
  isIdle(): boolean;
  hasPendingMessages?(): boolean;
  // Managed timers: unref'd, errors contained, cleared on session_shutdown.
  setInterval(fn: () => unknown, ms: number): unknown;
  setTimeout(fn: () => unknown, ms: number): unknown;
  clearTimer(t: unknown): void;
  ui: {
    notify(text: string, level?: string): void;
    setStatus?(key: string, text: string | undefined): void;
  };
}
// The fields this file reads from `agent_end` / `tool_call` events.
interface Ev {
  willContinue?: boolean;
  messages?: unknown;
  toolName?: string;
  input?: unknown;
}
interface Pi {
  on(event: string, handler: (event: Ev | undefined, ctx: Ctx) => unknown): void;
  setLabel?(label: string): void;
  sendUserMessage(text: string, opts?: { deliverAs?: string }): unknown;
}

const BIN = process.env.EIGHTSYNC_BIN?.trim() || "8sync";
const RUN_TIMEOUT_MS = 5_000;
const TICK_MS = 5_000;
const NUDGE_FIRST_MS = 30_000;
const NUDGE_AGAIN_MS = 5 * 60_000;
const STATUS_TTL_MS = 20_000;
const RESUME_MAX = 5;
const RESUME_TEXT = "[8sync:resume] tiếp tục việc đang dở";
const STATUS_KEY = "8sync-team";

// ── pure helpers (exported for checks; no I/O) ──────────────────────────────────────────────

/** `{"text": string}` → the text; null for `{"text": null}`, empty, or anything else. */
export function parseText(stdout: string | null | undefined): string | null {
  const v = parseObj(stdout);
  const t = v?.text;
  return typeof t === "string" && t.trim() !== "" ? t : null;
}

/** `{"ok": true}` from `--ack` / `--release`. */
export function parseOk(stdout: string | null | undefined): boolean {
  return parseObj(stdout)?.ok === true;
}

function parseObj(stdout: string | null | undefined): Record<string, unknown> | null {
  if (typeof stdout !== "string") return null;
  const s = stdout.trim();
  if (s[0] !== "{") return null;
  try {
    const v: unknown = JSON.parse(s);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Poll on every n-th 5 s tick after `empty` empty polls: 5 s for a minute, then 15 s, then 30 s. */
export function pollEvery(empty: number): number {
  if (empty < 12) return 1;
  if (empty < 24) return 3;
  return 6;
}

/** Wait before automatic resume number `n` (0-based): 60 s·2^n, capped at 15 min. */
export function resumeDelayMs(n: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, n), 15 * 60_000);
}

const LIMIT_RE = /\b429\b|rate[ _-]?limit|overload|quota|too many requests|usage limit/i;

/** Did this assistant message end the turn on a provider rate-limit / overload / quota error? */
export function isLimitError(m: Msg | undefined): boolean {
  if (!m || m.role !== "assistant" || m.stopReason !== "error") return false;
  let text = typeof m.errorMessage === "string" ? m.errorMessage : "";
  if (typeof m.content === "string") text += ` ${m.content}`;
  else if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (b && typeof b === "object" && "text" in b && typeof b.text === "string") text += ` ${b.text}`;
    }
  }
  return LIMIT_RE.test(text);
}

/** The last assistant message of a run. */
export function lastAssistant(messages: unknown): Msg | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m: unknown = messages[i];
    // An omp AgentMessage; the fields Msg names are all optional and re-checked by readers.
    if (m && typeof m === "object" && "role" in m && m.role === "assistant") return m as Msg;
  }
  return undefined;
}

/** Comparable path: no `\\?\` prefix, `/` separators, no trailing `/`, case-folded on Windows. */
export function normPath(p: string, win = process.platform === "win32"): string {
  let s = p.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
  while (s.length > 1 && s.endsWith("/") && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return win ? s.toLowerCase() : s;
}

/** `cwd` is `root` or inside it (both through `normPath`). */
function inside(cwd: string, root: string, win: boolean): boolean {
  const r = normPath(root, win);
  const here = normPath(cwd, win);
  return here === r || here.startsWith(r.endsWith("/") ? r : `${r}/`);
}

/**
 * Is the omp team's automation on for `cwd`, from `8sync ccc auto status --json`:
 * on, not paused, "omp" in `teams` (absent = ccc only), and `cwd` inside one of `repos`
 * (else `repo`) when scoped.
 */
export function teamOn(stdout: string | null | undefined, cwd: string, win = process.platform === "win32"): boolean {
  const v = parseObj(stdout);
  if (!v || v.on !== true || v.paused === true) return false;
  if (!Array.isArray(v.teams) || !v.teams.includes("omp")) return false;
  const many = Array.isArray(v.repos) ? v.repos.filter((r): r is string => typeof r === "string" && r !== "") : [];
  const roots = many.length > 0 ? many : typeof v.repo === "string" && v.repo !== "" ? [v.repo] : [];
  return roots.length === 0 || roots.some((r) => inside(cwd, r, win));
}

/** Automation and room-to-room delivery stay off unless the provider is known and not `anthropic`. */
export function providerBlocked(provider: string | null | undefined): boolean {
  const p = (provider ?? "").trim().toLowerCase();
  return p === "" || p === "anthropic";
}

/** 8sync's control files: whoever reads/writes them can forge owner messages, tokens or grants. */
const GUARDED = [
  "8sync/hq/inbox",
  "8sync/hq/ui-token",
  "8sync/hq/public.json",
  "8sync/hq/secrets.json",
  "8sync/ccc/permit",
  ".answer.json",
  "8sync/ccc/grants",
  "8sync/hq/usage/",
  ".taking.", // inbox claim in flight
  ".claimed", // claimed inbox message
];
/** Common bare names: a hit only when the same call also says `8sync` (e.g. `d=~/.config/8sync/hq; cat $d/ui-token`). */
const GUARDED_NEAR_8SYNC = ["public.json", "ui-token", "secrets.json"];
/** What write/edit tools carry as file *content*: 8sync's own source and docs may name the files above. */
const CONTENT_KEYS = ["content", "edits", "new_string", "old_string", "newText", "oldText", "text"];
const SCAN_DEPTH = 4;

function collectStrings(v: unknown, out: string[], depth: number): void {
  if (typeof v === "string") out.push(v);
  else if (depth <= 0 || !v || typeof v !== "object") return;
  else if (Array.isArray(v)) for (const x of v) collectStrings(x, out, depth - 1);
  else for (const [k, x] of Object.entries(v)) if (!CONTENT_KEYS.includes(k)) collectStrings(x, out, depth - 1);
}

/**
 * The guarded fragment a tool call mentions, else null. Every string field of the input is scanned
 * (nested arrays/objects too) except file content of write/edit tools; omp's hashline `edit` `input`
 * counts only by its `[PATH#TAG]` headers. Normalised: lowercase, `\` → `/`, `//` → `/`, `/./` → `/`.
 * Advisory hardening, not a sandbox: same-user processes stay trusted.
 */
export function guardHit(input: unknown, toolName?: string): string | null {
  let v = input;
  if (toolName === "edit" && v && typeof v === "object" && typeof (v as Record<string, unknown>).input === "string") {
    const headers = ((v as Record<string, unknown>).input as string).match(/^\[[^\]\n]*\]/gm) ?? [];
    v = { ...(v as Record<string, unknown>), input: headers.join("\n") };
  }
  const parts: string[] = [];
  collectStrings(v, parts, SCAN_DEPTH);
  const s = parts
    .join("\n")
    .toLowerCase()
    .replace(/[\\/]+/g, "/")
    .replace(/\/(?:\.\/)+/g, "/");
  return GUARDED.find((g) => s.includes(g)) ?? (s.includes("8sync") ? (GUARDED_NEAR_8SYNC.find((g) => s.includes(g)) ?? null) : null);
}

const ASK_REASON =
  "Owner đang vắng (8sync auto bật cho đội omp) — không hỏi, không chờ. Tự chấm từng phương án " +
  "FATAL / MAJOR / MINOR, chọn phương án an toàn nhất (hoặc phương án Recommended), ghi MỘT dòng vào " +
  "su-code/DECISIONS.md (ngày · câu hỏi · chọn gì · vì sao), rồi làm tiếp. NGOẠI LỆ — secret/đăng nhập, " +
  "xoá hoặc việc không đảo ngược được, tiền, deploy prod, merge/release, pháp lý/y tế/tuyển dụng/tín dụng: " +
  "KHÔNG tự quyết và KHÔNG hỏi; ghi vào báo cáo cuối là cần owner duyệt, rồi làm tiếp phần việc khác.";

// ── runtime ─────────────────────────────────────────────────────────────────────────────────

/** Run `8sync <args>`; stdout on exit 0, else null. Never throws. */
function run8sync(args: string[], cwd: string): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  try {
    execFile(
      BIN,
      args,
      { cwd: cwd || undefined, timeout: RUN_TIMEOUT_MS, windowsHide: true, encoding: "utf8", maxBuffer: 1 << 20 },
      (err, stdout) => resolve(err ? null : String(stdout)),
    );
  } catch {
    resolve(null);
  }
  return promise;
}

export default function (pi: Pi) {
  // Every session, room or not, automation on or off: no tool touches 8sync's control files.
  pi.on("tool_call", async (event) => {
    const hit = guardHit(event?.input, event?.toolName);
    if (hit === null) return undefined;
    return {
      block: true,
      reason:
        `8sync: chặn — lệnh/đường dẫn chạm file điều khiển của 8sync (\`${hit}\`: inbox/token/secrets/permit/grants của HQ). ` +
        "Agent không được đọc hay sửa các file này; việc cần owner thì ghi vào báo cáo cho owner.",
    };
  });

  const envId = process.env.EIGHTSYNC_ROOM_ID?.trim();
  if (!envId) return;
  const roomId: string = envId;
  const room = process.env.EIGHTSYNC_ROOM?.trim() || roomId;
  pi.setLabel?.(`8sync team (đội omp · ${room})`);

  // Per-session state (this closure is bound once per session).
  let ctx: Ctx | undefined;
  let tick: unknown;
  let busy = false; // one 8sync call chain at a time
  let empty = 0;
  let ticks = 0;
  let nudgeAt: number | null = null;
  let resumes = 0;
  let resumeTimer: unknown;
  let warned = false;
  let status = { at: 0, on: false };

  const isMain = (c: Ctx) => c.agent?.kind !== "sub";
  const idleNow = (c: Ctx) => c.isIdle() && !(c.hasPendingMessages?.() ?? false);

  /** Automation (2–4) allowed right now; one notice when the provider is anthropic or unknown. */
  async function automationOn(c: Ctx): Promise<boolean> {
    if (providerBlocked(c.model?.provider)) {
      if (!warned && c.hasUI) {
        warned = true;
        c.ui.notify(
          "8sync đội omp: model provider là anthropic hoặc không rõ — tự động (nudge/resume/ask, tin giữa các phòng) tắt; gói Claude chỉ dùng trong Claude Code. Inbox vẫn nhận tin của owner.",
          "warning",
        );
      }
      return false;
    }
    const now = Date.now();
    if (now - status.at > STATUS_TTL_MS) {
      status = { at: now, on: teamOn(await run8sync(["ccc", "auto", "status", "--json"], c.cwd), c.cwd) };
    }
    return status.on;
  }

  /**
   * Hand `text` to the session; false when omp refused it. Idle → a new prompt: an idle
   * `followUp` only drains when the last message is the assistant's and the owner did not
   * interrupt, so in a fresh room or after Esc it would sit queued. Busy (lost the race) →
   * `followUp`, behind the running turn. omp reports async send failures itself.
   */
  function send(c: Ctx, text: string): boolean {
    try {
      pi.sendUserMessage(text, c.isIdle() ? undefined : { deliverAs: "followUp" });
      return true;
    } catch {
      return false;
    }
  }

  async function pollInbox(c: Ctx): Promise<boolean> {
    // Anthropic/unknown provider: only the owner's own lines; room lines stay queued.
    const base = ["ccc", "inbox", "--session", roomId, ...(providerBlocked(c.model?.provider) ? ["--owner-only"] : [])];
    const text = parseText(await run8sync([...base, "--json"], c.cwd));
    if (text === null) return false;
    const entered = send(c, text);
    const flag = entered ? "--ack" : "--release";
    for (let i = 0; i < 2; i += 1) {
      if (parseOk(await run8sync([...base, flag, "--json"], c.cwd))) break;
    }
    return entered;
  }

  async function nudge(c: Ctx): Promise<boolean> {
    if (!(await automationOn(c))) return false;
    const out = await run8sync(["ccc", "auto", "nudge", "--session", roomId, "--cwd", c.cwd, "--json"], c.cwd);
    const text = parseText(out);
    if (text === null || !idleNow(c)) return false;
    return send(c, text);
  }

  async function onTick() {
    const c = ctx;
    if (!c || busy || !c.isIdle()) return;
    busy = true;
    try {
      ticks += 1;
      if (ticks % pollEvery(empty) === 0) {
        if (await pollInbox(c)) {
          empty = 0;
          nudgeAt = null; // a turn is starting; agent_end re-arms
          return;
        }
        empty += 1;
      }
      if (nudgeAt !== null && Date.now() >= nudgeAt && resumeTimer === undefined && idleNow(c)) {
        nudgeAt = (await nudge(c)) ? null : Date.now() + NUDGE_AGAIN_MS;
      }
    } finally {
      busy = false;
    }
  }

  function scheduleResume(c: Ctx) {
    if (resumeTimer !== undefined) c.clearTimer(resumeTimer);
    const delay = resumeDelayMs(resumes);
    resumes += 1;
    if (c.hasUI) c.ui.notify(`8sync: lỗi giới hạn của provider — tự tiếp tục sau ${Math.round(delay / 1000)} s (lần ${resumes}/${RESUME_MAX}).`, "info");
    resumeTimer = c.setTimeout(async () => {
      resumeTimer = undefined;
      const cur = ctx ?? c;
      if (!idleNow(cur) || !(await automationOn(cur))) return;
      send(cur, RESUME_TEXT);
    }, delay);
  }

  pi.on("session_start", async (_e, c) => {
    if (!isMain(c)) return;
    ctx = c;
    empty = 0;
    ticks = 0;
    nudgeAt = Date.now() + NUDGE_FIRST_MS;
    if (c.hasUI) c.ui.setStatus?.(STATUS_KEY, `đội omp · ${room}`);
    if (tick !== undefined) c.clearTimer(tick);
    tick = c.setInterval(onTick, TICK_MS);
  });

  pi.on("input", async (_e, c) => {
    if (!isMain(c)) return;
    // The owner typed: their prompt resets the automatic-resume streak.
    resumes = 0;
    if (resumeTimer !== undefined) c.clearTimer(resumeTimer);
    resumeTimer = undefined;
  });

  pi.on("agent_end", async (event, c) => {
    if (!isMain(c)) return;
    ctx = c;
    if (event?.willContinue === true) return; // omp itself retries / continues
    empty = 0;
    ticks = 0;
    const last = lastAssistant(event?.messages);
    if (last?.stopReason === "aborted") {
      nudgeAt = null; // the owner pressed Esc: they are here
      return;
    }
    if (last?.stopReason === "error") {
      nudgeAt = null; // a nudge cannot fix a failing provider; only limit errors resume
      if (!isLimitError(last)) return;
      if (resumes >= RESUME_MAX) {
        if (c.hasUI) c.ui.notify(`8sync: đã tự tiếp tục ${RESUME_MAX} lần liên tiếp vẫn lỗi giới hạn — dừng, chờ owner.`, "warning");
        return;
      }
      if (await automationOn(c)) scheduleResume(c);
      return;
    }
    resumes = 0;
    nudgeAt = Date.now() + NUDGE_FIRST_MS;
  });

  pi.on("tool_call", async (event, c) => {
    if (!isMain(c) || event?.toolName !== "ask") return undefined;
    if (!(await automationOn(c))) return undefined;
    return { block: true, reason: ASK_REASON };
  });

  pi.on("session_shutdown", async (_e, c) => {
    if (tick !== undefined) c.clearTimer(tick);
    if (resumeTimer !== undefined) c.clearTimer(resumeTimer);
    tick = undefined;
    resumeTimer = undefined;
    ctx = undefined;
  });
}
