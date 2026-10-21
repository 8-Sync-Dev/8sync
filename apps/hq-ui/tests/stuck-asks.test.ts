import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { Ask } from "@/lib/ask";
import { closeDialog } from "@/lib/server/stuck-asks";
import { criticMessage, STUCK_AFTER_MS, STUCK_MIN_MS, stuckAfterMs, stuckAsks, type StuckRoom } from "@/lib/stuck-asks";

const q = (at: number | null): Ask => ({
  kind: "question",
  at,
  questions: [{ header: "Tiến hoá", question: "Sửa lỗi gà ra voi?", multi: false, options: [{ label: "Dòng tiến hoá (Recommended)", description: null }, { label: "Bỏ tiến hoá", description: null }] }],
});
const room = (sid: string, ask: Ask | null, delivery: StuckRoom["delivery"] = "inbox"): StuckRoom => ({ session_id: sid, cwd: "/w/game", delivery, ask });

describe("stuck questions go to the critic (seen live 2026-10-18: 7 rooms waited an hour)", () => {
  const now = 10_000_000;
  it("only a background room's question older than a minute, once per question", () => {
    const rooms = [
      room("a", q(now - STUCK_AFTER_MS - 1)),
      room("b", q(now - 5_000)),
      room("c", q(now - STUCK_AFTER_MS - 1), "terminal"),
      room("d", { kind: "permission", tool: "Bash", what: "ls", at: now - 600_000 }),
      room("e", null),
      room("f", q(null)),
    ];
    expect(stuckAsks(rooms, {}, now).map((r) => r.session_id)).toEqual(["a"]);
    // Already handed over: never twice for the same question.
    expect(stuckAsks(rooms, { a: now - STUCK_AFTER_MS - 1 }, now)).toEqual([]);
    expect(stuckAsks([room("a", q(now - 200_000))], { a: now - STUCK_AFTER_MS - 1 }, now)).toHaveLength(1);
  });

  it("the threshold follows 8sync's `after_s` (owner 2026-10-22: 5 s, not a minute), floored at 5 s, the old minute without it", () => {
    expect(stuckAfterMs(5)).toBe(5_000);
    expect(stuckAfterMs(1)).toBe(STUCK_MIN_MS);
    expect(stuckAfterMs(120)).toBe(120_000);
    expect(stuckAfterMs(null)).toBe(STUCK_AFTER_MS);
    expect(stuckAfterMs(0)).toBe(STUCK_AFTER_MS);
    // A 6 s old question is stuck at the 5 s threshold, not at the minute.
    const rooms = [room("a", q(now - 6_000))];
    expect(stuckAsks(rooms, {}, now, stuckAfterMs(5))).toHaveLength(1);
    expect(stuckAsks(rooms, {}, now)).toHaveLength(0);
  });

  it("the room's message names the questions and carries the critic route", () => {
    const m = criticMessage(q(1) as Extract<Ask, { kind: "question" }>, "8sync delegate: gọi critic");
    expect(m).toContain("Sửa lỗi gà ra voi? [Dòng tiến hoá (Recommended) | Bỏ tiến hoá]");
    expect(m).toContain("Đừng hỏi lại owner");
    expect(m.endsWith("8sync delegate: gọi critic")).toBe(true);
  });

  it("closes the dialog with one Esc through the terminal bridge and ends it", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter() as EventEmitter & { resume: () => void },
      stderr: new EventEmitter() as EventEmitter & { resume: () => void },
      stdin: { write: (s: string) => writes.push(s), end: vi.fn() },
      kill: vi.fn(),
    });
    proc.stdout.resume = () => {};
    proc.stderr.resume = () => {};
    const spawn = vi.fn(() => proc);
    const done = closeDialog("3698e3a6-9b73-4b37-ab3a-368b169d0508", "/w/game", spawn as never);
    await vi.runAllTimersAsync();
    await done;
    expect(spawn).toHaveBeenCalledWith("8sync", ["ccc", "term", "3698e3a6-9b73-4b37-ab3a-368b169d0508", "--cols", "120", "--rows", "34"], expect.objectContaining({ cwd: "/w/game" }));
    expect(writes).toEqual([`${JSON.stringify({ i: "\u001b" })}\n`]);
    expect(proc.stdin.end).toHaveBeenCalled();
    expect(proc.kill).toHaveBeenCalled();
    vi.useRealTimers();
  });
});
