import { describe, expect, it } from "vitest";
import { deriveFloor, isOldIdle, sortFloor, toolOf, type FloorRow } from "@/lib/floor";

const NOW = 1_800_000_000_000;
const ago = (s: number) => NOW / 1000 - s;

describe("deriveFloor", () => {
  const cases: [string, Parameters<typeof deriveFloor>[0], Parameters<typeof deriveFloor>[1], string, string][] = [
    ["needs_input -> waiting", { status: "running", last_tool: "Edit", last_active: ago(5) }, { status: "needs_input", detail: "Trust folder?" }, "waiting", "chờ anh"],
    ["stalled_error wins over tool", { status: "active", last_tool: "Edit", stalled_error: "API Error 529", last_active: ago(5) }, null, "stalled", "kẹt"],
    ["running, quiet > 5 min with open tasks -> stalled", { status: "running", last_tool: "Bash", last_active: ago(400), tasks_done: 1, tasks_total: 3 }, null, "stalled", "kẹt"],
    ["running, quiet > 5 min, nothing open -> resting at the prompt", { status: "running", last_tool: "Bash", last_active: ago(400) }, null, "idle", "nghỉ"],
    ["running 4 min is not stalled", { status: "running", last_tool: "Bash", last_active: ago(240) }, null, "running", "chạy lệnh"],
    ["hq idle prompt is rest, not stall", { status: "running", last_active: ago(900) }, { status: "idle" }, "idle", "nghỉ"],
    ["Edit -> typing", { status: "active", last_tool: "Edit", last_active: ago(10) }, null, "typing", "đang gõ code"],
    ["MultiEdit from last_activity", { status: "running", last_activity: "MultiEdit: a.ts", last_active: ago(10) }, null, "typing", "đang gõ code"],
    ["Bash -> running", { status: "running", last_tool: "Bash", last_active: ago(10) }, null, "running", "chạy lệnh"],
    ["Monitor -> running", { status: "active", last_activity: "Monitor: tail", last_active: ago(10) }, null, "running", "chạy lệnh"],
    ["Grep -> reading", { status: "active", last_tool: "Grep", last_active: ago(10) }, null, "reading", "đọc/tìm"],
    ["WebSearch -> reading", { status: "running", last_activity: "WebSearch: x", last_active: ago(10) }, null, "reading", "đọc/tìm"],
    ["unknown tool while live -> generic work", { status: "active", last_tool: "mcp__x__y", last_active: ago(10) }, null, "typing", "đang làm"],
    ["all tasks done, not running -> done", { status: "active", tasks_done: 3, tasks_total: 3, last_tool: "Edit", last_active: ago(10) }, null, "done", "xong"],
    ["all done but still running -> keeps working", { status: "running", tasks_done: 3, tasks_total: 3, last_tool: "Bash", last_active: ago(10) }, null, "running", "chạy lệnh"],
    ["total 0 is not done", { status: "idle", tasks_done: 0, tasks_total: 0 }, null, "idle", "nghỉ"],
    ["idle ignores old tool", { status: "idle", last_tool: "Edit", last_active: ago(7200) }, null, "idle", "nghỉ"],
  ];
  it.each(cases)("%s", (_n, ls, hq, state, label) => {
    const d = deriveFloor(ls, hq, NOW);
    expect(d.state).toBe(state);
    expect(d.label).toBe(label);
  });

  it("progress and one-line truncated caption", () => {
    const d = deriveFloor({ status: "running", last_tool: "Bash", doing: `run\n${"x".repeat(300)}`, tasks_done: 3, tasks_total: 7, last_active: ago(1) }, null, NOW);
    expect(d.progress).toBe("3/7");
    expect(d.caption).not.toContain("\n");
    expect(d.caption.length).toBeLessThanOrEqual(120);
  });
  it("hq-only session (no ls row) works", () => {
    expect(deriveFloor(null, { status: "running" }, NOW).state).toBe("typing");
    expect(deriveFloor(null, { status: "idle" }, NOW).state).toBe("idle");
  });
  it("toolOf prefers last_tool, else the prefix before ':'", () => {
    expect(toolOf({ last_tool: "Read", last_activity: "Bash: x" })).toBe("read");
    expect(toolOf({ last_activity: "Glob: **/*.rs" })).toBe("glob");
    expect(toolOf({ last_activity: "no colon" })).toBeNull();
  });
});

describe("ordering", () => {
  const row = (id: string, state: FloorRow["state"], last: number | null): FloorRow => ({ id, name: id, title: id, state, label: "", caption: "", progress: null, last_active: last, hq: true });
  it("waiting, stalled, working, done, idle; newest first inside a group", () => {
    const out = sortFloor([row("i", "idle", 9), row("d", "done", 9), row("t1", "typing", 1), row("t2", "reading", 5), row("s", "stalled", 1), row("w", "waiting", 1)]);
    expect(out.map((r) => r.id)).toEqual(["w", "s", "t2", "t1", "d", "i"]);
  });
  it("old idle > 1 day only", () => {
    expect(isOldIdle(row("a", "idle", NOW / 1000 - 90_000), NOW)).toBe(true);
    expect(isOldIdle(row("a", "idle", NOW / 1000 - 3600), NOW)).toBe(false);
    expect(isOldIdle(row("a", "typing", 1), NOW)).toBe(false);
  });
});
