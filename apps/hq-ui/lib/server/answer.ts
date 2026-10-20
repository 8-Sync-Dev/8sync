// One-tap answers for a background room's dialog (owner 2026-10-20: "Auto fix kẹt hoặc nút gấp").
// Attaches through the same bridge as the web terminal (`8sync ccc term <id> --cols 120 --rows 34`),
// answers ConPTY's cursor query, reads the screen, and only types the allowlisted keys while the
// screen still shows the dialog the owner saw; then the bridge is closed (the room keeps running).
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { flatText, permissionOnScreen, questionOnScreen, renderScreen } from "../screen";
import { binFor, childEnv } from "./child-env";
import { termArgs } from "./term";

/** Enter (the highlighted choice), Esc (No / cancel), an option number. Nothing else is ever typed. */
export const ANSWER_KEYS: readonly string[] = ["\r", "\u001b", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
const COLS = 120;
const ROWS = 34;
/** ConPTY asks where the cursor is (`ESC[6n`) before it draws; the attach waits for this reply. */
export const CURSOR_REPLY = "\u001b[1;1R";

/** What the owner saw: a permission prompt, or one single-choice question with these option labels. */
export type Expect = { kind: "permission" } | { kind: "question"; question: string; options: readonly string[] };
export type Dialog = { kind: "permission"; text: string; yes: boolean } | { kind: "question"; text: string };
export type AnswerResult = { ok: true; dialog: Dialog } | { ok: false; status: number; error: string };

type Spawn = (cmd: string, args: string[], opts: { cwd?: string; windowsHide: boolean; env?: NodeJS.ProcessEnv }) => ChildProcessWithoutNullStreams;

/** Timings (ms); tests shrink them. Everything ends by `deadline`. */
export const TIMING = { settleMin: 2000, quiet: 600, settleMax: 6000, keyGap: 250, afterKeys: 700, deadline: 10_000 };

export const MOVED = "màn hình đã đổi, mở terminal";

/** The dialog `expect` describes, as the screen shows it now; null when the room moved on. */
export function dialogOnScreen(lines: string[], expect: Expect): Dialog | null {
  if (expect.kind === "permission") {
    const p = permissionOnScreen(lines);
    return p ? { kind: "permission", ...p } : null;
  }
  const text = questionOnScreen(lines, expect.question, expect.options);
  return text ? { kind: "question", text } : null;
}

/**
 * Keys that fit the dialog: Enter only for a permission prompt (the cursor must sit on "1. Yes"), Esc
 * anywhere, an option number alone for a question (Claude Code's AskUserQuestion submits on the
 * digit: an Enter after it would land on whatever shows next).
 */
export function keysFit(keys: string[], expect: Expect): boolean {
  if (keys.length !== 1 || !ANSWER_KEYS.includes(keys[0])) return false;
  const k = keys[0];
  if (k === "\u001b") return true;
  if (expect.kind === "permission") return k === "\r";
  return k !== "\r" && Number(k) >= 1 && Number(k) <= expect.options.length;
}

const busy = new Set<string>();

/**
 * Reads the room's screen; with `keys`, types them only if `expect` still shows AND its text is the
 * very text the owner was shown (`shown`, compared after flatText): a new dialog in the same room,
 * even of the same kind, never takes the click. Enter on a permission prompt also needs the cursor on
 * "1. Yes". No keys: a read-only peek.
 */
export function answerRoom(sid: string, cwd: string | null, expect: Expect, keys: string[], shown: string | null, spawn: Spawn = nodeSpawn as unknown as Spawn): Promise<AnswerResult> {
  // 429, not 409: busy is no proof the screen moved on.
  if (busy.has(sid)) return Promise.resolve({ ok: false, status: 429, error: "đang đọc màn hình phòng này, thử lại sau vài giây" });
  busy.add(sid);
  return new Promise<AnswerResult>((resolve) => {
    const started = Date.now();
    let out = "";
    let lastData = started;
    let replied = false;
    let settled = false;
    /** Set once the keys go out: the bridge closing after that is no failure. */
    let sent: Dialog | null = null;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const proc = spawn(binFor("8sync"), termArgs(sid, COLS, ROWS), { cwd: cwd ?? undefined, windowsHide: true, env: childEnv() });
    const type = (i: string) => {
      if (!proc.stdin.destroyed) proc.stdin.write(`${JSON.stringify({ i })}\n`);
    };
    const finish = (r: AnswerResult) => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      busy.delete(sid);
      try {
        proc.stdin.end();
      } catch {
        /* closed */
      }
      try {
        proc.kill();
      } catch {
        /* gone */
      }
      resolve(r);
    };
    const reply = () => {
      if (replied) return;
      replied = true;
      type(CURSOR_REPLY);
    };
    proc.stdout.on("data", (b: Buffer) => {
      out += b.toString("utf8");
      lastData = Date.now();
      reply();
    });
    proc.stderr.resume();
    proc.on("error", () => finish({ ok: false, status: 502, error: "không mở được terminal của phòng" }));
    proc.on("exit", () => finish(sent ? { ok: true, dialog: sent } : { ok: false, status: 502, error: "terminal của phòng đóng trước khi đọc được màn hình" }));
    later(TIMING.deadline, () => finish({ ok: false, status: 504, error: "phòng không trả màn hình kịp, mở terminal" }));
    // No output yet (an attach that waits for the reply first): answer the query anyway.
    later(Math.min(1500, TIMING.settleMin), reply);

    const check = () => {
      const now = Date.now();
      if (now - started < TIMING.settleMin || (now - lastData < TIMING.quiet && now - started < TIMING.settleMax)) {
        later(100, check);
        return;
      }
      const dialog = dialogOnScreen(renderScreen(out, COLS, ROWS), expect);
      const stale = keys.length > 0 && (!shown || !dialog || flatText(dialog.text) !== flatText(shown));
      if (!dialog || stale || (keys[0] === "\r" && dialog.kind === "permission" && !dialog.yes)) {
        finish({ ok: false, status: 409, error: MOVED });
        return;
      }
      if (!keys.length) {
        finish({ ok: true, dialog });
        return;
      }
      sent = dialog;
      keys.forEach((k, n) => later(n * TIMING.keyGap, () => type(k)));
      later(keys.length * TIMING.keyGap + TIMING.afterKeys, () => finish({ ok: true, dialog }));
    };
    later(100, check);
  });
}
