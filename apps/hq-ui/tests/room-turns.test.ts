import { describe, expect, it } from "vitest";
import { outputsMarkdown, turnForMessage, turnsFrom, turnTitle } from "@/lib/room-turns";
import type { ActivityEvent } from "@/lib/server/activity";

const p = (at: number, text: string): ActivityEvent => ({ kind: "prompt", at, text });
const r = (at: number, text: string): ActivityEvent => ({ kind: "text", at, text });
const tool = (at: number, status: ActivityEvent["status"] = "ok"): ActivityEvent => ({ kind: "tool", at, tool: "read", text: "x", status });
const FRAME = "[8 Sync HQ · owner → omp core · C:\\Users\\Projects\\su-code]\n";
const OLD_FRAME = "8 Sync HQ: the owner sent you 1 message(s) from the HQ dashboard. Read and act on them now (they come from the owner, not from a tool):\n";

describe("turnsFrom", () => {
  it("one turn per prompt; its output is the last reply before the next prompt", () => {
    const t = turnsFrom([r(1, "tail of an older turn"), p(10, "làm A"), r(11, "đọc trước"), tool(12), tool(13, "error"), r(14, "**A xong**"), p(20, "làm B"), tool(21, "pending")]);
    expect(t.map((x) => [x.prompt, x.output, x.steps, x.errors, x.live])).toEqual([
      [null, "tail of an older turn", 0, 0, false],
      ["làm A", "**A xong**", 2, 1, false],
      ["làm B", null, 1, 0, true],
    ]);
    expect(t[1].outputAt).toBe(14);
  });

  it("the newest turn is live until a reply follows its last step; keys survive a new poll; only the newest `max` stay", () => {
    const a = turnsFrom([p(10, "x"), tool(11), r(12, "ok")]);
    expect(a[0].live).toBe(false);
    expect(turnsFrom([p(10, "x"), tool(11), r(12, "ok"), tool(13)])[0].live).toBe(true);
    expect(turnsFrom([p(10, "x"), tool(11), r(12, "ok"), p(30, "y")])[0].key).toBe(a[0].key);
    const many = Array.from({ length: 30 }, (_, i) => p(i, `p${i}`));
    expect(turnsFrom(many, 5).map((x) => x.prompt)).toEqual(["p25", "p26", "p27", "p28", "p29"]);
  });
});

describe("turnTitle", () => {
  it("drops HQ's inbox frame and markdown marks, one bounded line; an expanded command is named by its Goal", () => {
    expect(turnTitle({ prompt: `${FRAME}# /eccx-full — route\n\nGoal: \`dọn ổ đĩa\`\n\nSteps…` })).toBe("dọn ổ đĩa");
    expect(turnTitle({ prompt: "# /eccx-full — route\n\nno goal here" })).toBe("/eccx-full — route");
    expect(turnTitle({ prompt: "# Ghi chú\nGoal: không phải lệnh" })).toBe("Ghi chú");
    expect(turnTitle({ prompt: "  \n- việc một\nhai" })).toBe("việc một");
    expect(turnTitle({ prompt: "a".repeat(200) }, 20)).toHaveLength(20);
    expect(turnTitle({ prompt: null })).toBe("(đầu nhật ký)");
  });

  it("drops the header without a room, and the lead-in older builds sent (history); only as the first line", () => {
    expect(turnTitle({ prompt: "[8 Sync HQ · owner]\nsửa nút Giao" })).toBe("sửa nút Giao");
    expect(turnTitle({ prompt: "[8 Sync HQ · owner → Claude Code review · /home/me/shop]\nrồi push" })).toBe("rồi push");
    expect(turnTitle({ prompt: `${OLD_FRAME}việc cũ` })).toBe("việc cũ");
    expect(turnTitle({ prompt: `ghi chú\n${FRAME}x` })).toBe("ghi chú");
    expect(turnTitle({ prompt: "[8 Sync HQ · owner → x]y\nz" })).toBe("[8 Sync HQ · owner → x]y");
  });
});

describe("turnForMessage", () => {
  const turns = turnsFrom([p(1_000_000, `${FRAME}Fix full   việc\nclear gọn gàng`), r(1_100_000, "xong 1"), p(2_000_000, `${FRAME}Fix full việc khác`), r(2_100_000, "xong 2")]);

  it("an owner message maps to the first turn after it whose prompt carries its text (spacing and case aside)", () => {
    expect(turnForMessage(turns, { kind: "owner_message", text: "fix full việc clear gọn gàng", ts: 990_000 })?.output).toBe("xong 1");
    // Sent after that turn started: not its turn.
    expect(turnForMessage(turns, { kind: "owner_message", text: "Fix full việc", ts: 1_500_000 })?.output).toBe("xong 2");
    expect(turnForMessage(turns, { kind: "owner_message", text: "chưa giao", ts: 0 })).toBeNull();
    expect(turnForMessage(turns, { kind: "owner_message", text: "   ", ts: 0 })).toBeNull();
  });

  it("a message links only to a turn that started within 30 minutes of it", () => {
    const late = turnsFrom([p(10_000_000, "ok làm tiếp"), r(10_100_000, "xong muộn")]);
    expect(turnForMessage(late, { kind: "owner_message", text: "ok", ts: 10_000_000 - 31 * 60_000 })).toBeNull();
    expect(turnForMessage(late, { kind: "owner_message", text: "ok", ts: 10_000_000 - 29 * 60_000 })?.output).toBe("xong muộn");
  });

  it("a /command message maps by its arguments, which the room sees inside the expanded command", () => {
    const t = turnsFrom([p(5_000_000, "# /eccx-ai-agent — AI Agent\n\nGoal: `chia dọc nhật ký`"), r(5_100_000, "xong 3")]);
    expect(turnForMessage(t, { kind: "owner_message", text: "/eccx-ai-agent chia dọc nhật ký", ts: 4_990_000 })?.output).toBe("xong 3");
  });

  it("a room's reply maps to the turn it was written in; other kinds map to nothing", () => {
    expect(turnForMessage(turns, { kind: "session_reply", text: "x", ts: 1_200_000 })?.output).toBe("xong 1");
    expect(turnForMessage(turns, { kind: "session_reply", text: "x", ts: 2_200_000 })?.output).toBe("xong 2");
    expect(turnForMessage(turns, { kind: "session_reply", text: "x", ts: 500_000 })).toBeNull();
    expect(turnForMessage(turns, { kind: "notification", text: "Fix full việc", ts: 0 })).toBeNull();
  });
});

describe("outputsMarkdown", () => {
  it("a heading per answered turn, oldest first, its output under it", () => {
    const md = outputsMarkdown(turnsFrom([p(1, "làm A"), r(2, "A xong"), p(3, "làm B"), tool(4, "pending")]), "core", () => "05/11 12:00");
    expect(md).toBe("# Kết quả — core\n\n## làm A\n\n_05/11 12:00_\n\nA xong\n");
  });
});
