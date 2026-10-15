import { describe, expect, it } from "vitest";
import {
  ageLabel,
  cleanTitle,
  deriveFloor,
  disambiguate,
  engineLabel,
  groupFloor,
  isOldIdle,
  repoName,
  sortFloor,
  toolOf,
  type FloorRow,
} from "@/lib/floor";

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
    ["fresh STANDUP.md -> sprint meeting", { status: "running", last_tool: "Edit", last_active: ago(5) }, { status: "running", standup: { slug: "autowork", at: NOW - 30_000 } }, "meeting", "họp sprint"],
    ["standup older than 2 min -> back to work", { status: "running", last_tool: "Edit", last_active: ago(5) }, { status: "running", standup: { slug: "autowork", at: NOW - 3 * 60_000 } }, "typing", "đang gõ code"],
    ["needs_input wins over a meeting", { status: "running", last_tool: "Edit", last_active: ago(5) }, { status: "needs_input", detail: "Ship?", standup: { slug: "a", at: NOW } }, "waiting", "chờ anh"],
    ["an idle desk does not meet", { status: "idle", last_active: ago(5) }, { status: "idle", standup: { slug: "a", at: NOW } }, "idle", "nghỉ"],
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

describe("display helpers", () => {
  it.each([
    ["🔗 TRACE: Clarify agent domain grouping", "Clarify agent domain grouping"],
    ["💰 QUOTE: Estimate cost", "Estimate cost"],
    ["📋 BAOCAO: Báo cáo tiến độ", "Báo cáo tiến độ"],
    ["🖥️ APP: Run app", "Run app"],
    ["🗓️ WEEKLY: Update weeks", "Update weeks"],
    ["Trace copilot knowledge", "Trace copilot knowledge"],
    ["Fix: lowercase tag stays", "Fix: lowercase tag stays"],
    ["core", "core"],
    ["🔗", "🔗"],
    ["", ""],
  ])("cleanTitle(%j) -> %j", (raw, out) => expect(cleanTitle(raw)).toBe(out));

  it("engine, repo name, age", () => {
    expect(engineLabel("ccc")).toBe("Claude");
    expect(engineLabel("omp")).toBe("omp");
    expect(engineLabel("feynman")).toBe("feynman");
    expect(engineLabel(null)).toBeNull();
    expect(repoName("~/startup/su-code/")).toBe("su-code");
    expect(repoName("-home-x-fix")).toBe("-home-x-fix");
    expect(repoName(null)).toBe("Khác");
    expect(ageLabel(NOW / 1000 - 30, NOW)).toBe("vừa xong");
    expect(ageLabel(NOW / 1000 - 600, NOW)).toBe("10 phút");
    expect(ageLabel(NOW / 1000 - 7200, NOW)).toBe("2 giờ");
    expect(ageLabel(NOW / 1000 - 3 * 86400, NOW)).toBe("3 ngày");
    expect(ageLabel(null, NOW)).toBe("");
  });
});

describe("grouping by repo", () => {
  const r = (id: string, name: string, repo: string | null, state: FloorRow["state"], last = NOW / 1000 - 60, extra: Partial<FloorRow> = {}): FloorRow => ({
    id, name, title: name, repo, state, label: "", caption: "", progress: null, last_active: last, hq: false, ...extra,
  });

  it("never shows a full session uuid as the desk name", () => {
    const U = "6ede5cff-b5c6-4324-a64f-be210e36ba8e";
    const out = disambiguate([r("1", U, "~/a", "idle", undefined, { sid: "6ede5cff" }), r("2", U, "~/a", "idle", undefined, { sid: "11112222" })]);
    expect(out.map((x) => x.who)).toEqual(["6ede5cff · 6ede5cff", "6ede5cff · 11112222"]);
    expect(disambiguate([r("3", U, "~/b", "idle", undefined, { sid: "6ede5cff" })])[0].who).toBe("6ede5cff");
  });

  it("identical names in one repo get the 8-char id, else #n; other repos untouched", () => {
    const out = disambiguate([
      r("1", "core", "~/a", "idle", undefined, { sid: "abcd1234" }),
      r("2", "core", "~/a", "idle"),
      r("3", "core", "~/b", "idle"),
      r("4", "feats", "~/a", "idle", undefined, { title: "🔗 TRACE: Clarify x" }),
    ]);
    expect(out.map((x) => x.who)).toEqual(["core · abcd1234", "core · #2", "core", "feats"]);
    expect(out[3].heading).toBe("Clarify x");
    expect(out[3].title).toBe("🔗 TRACE: Clarify x");
  });

  it("splits desks (active) from the quiet list, repos needing the owner first, old idle aside", () => {
    const { groups, old } = groupFloor(
      [
        r("a1", "core", "~/a", "typing", NOW / 1000 - 5),
        r("a2", "price", "~/a", "idle", NOW / 1000 - 600),
        r("a3", "done", "~/a", "done", NOW / 1000 - 60),
        r("b1", "core", "~/b", "idle", NOW / 1000 - 30),
        r("b2", "fix", "~/b", "waiting", NOW / 1000 - 3000),
        r("c1", "old", "~/c", "idle", NOW / 1000 - 90_000),
        r("n1", "x", null, "running", NOW / 1000 - 1),
        r("a4", "rd", "~/a", "meeting", NOW / 1000 - 10),
      ],
      NOW,
    );
    expect(groups.map((g) => g.repo)).toEqual(["~/b", "", "~/a"]);
    const b = groups[0];
    expect(b.needs).toBe(1);
    expect(b.desks.map((x) => x.id)).toEqual(["b2"]);
    expect(b.rest.map((x) => x.id)).toEqual(["b1"]);
    const a = groups[2];
    expect(a.working).toBe(2);
    expect(a.desks.map((x) => x.id)).toEqual(["a1", "a4"]);
    expect(a.rest.map((x) => x.id)).toEqual(["a3", "a2"]);
    expect(groups[1].name).toBe("Khác");
    expect(old.map((x) => x.id)).toEqual(["c1"]);
  });
});

describe("uuid display", () => {
  it("an untitled session's uuid title and sid show as 8 chars", async () => {
    const { cleanTitle, shortId } = await import("../lib/floor");
    expect(cleanTitle("a2830544-0719-4d6f-aaa3-644783ddb0b3")).toBe("phiên a2830544");
    expect(shortId("6ede5cff-b5c6-4324-a64f-be210e36ba8e")).toBe("6ede5cff");
    expect(shortId("hq-alpha")).toBe("hq-alpha");
    expect(shortId(null)).toBeNull();
  });
});

import { HANDOFF_MS, deriveHandoffs, handoffLabel } from "@/lib/floor";

describe("deriveHandoffs", () => {
  const msg = (ts: number, from_: string | null, to_: string | null, kind = "session_message") => ({ ts, kind, session: from_, from_, to_ });
  it("A gets an out bubble, B an in bubble, only for events newer than the last refresh", () => {
    const m = deriveHandoffs([msg(NOW - 1000, "hq-a", "hq-b"), msg(NOW - 3000, "hq-c", "hq-d")], NOW - 2000, NOW);
    expect(m.get("hq-a")).toEqual({ dir: "out", peer: "hq-b", ts: NOW - 1000 });
    expect(m.get("hq-b")).toEqual({ dir: "in", peer: "hq-a", ts: NOW - 1000 });
    expect(m.has("hq-c")).toBe(false);
    expect(handoffLabel(m.get("hq-a")!)).toBe("→ hq-b");
    expect(handoffLabel(m.get("hq-b")!, "a")).toBe("← a");
  });
  it("expires after HANDOFF_MS and ignores other kinds / self / missing peer", () => {
    expect(deriveHandoffs([msg(NOW - HANDOFF_MS - 1, "hq-a", "hq-b")], 0, NOW).size).toBe(0);
    expect(deriveHandoffs([msg(NOW - 10, "hq-a", "hq-b", "notification"), msg(NOW - 10, "hq-a", "hq-a"), msg(NOW - 10, "hq-a", null)], 0, NOW).size).toBe(0);
  });
  it("latest event wins per desk", () => {
    const m = deriveHandoffs([msg(NOW - 900, "hq-a", "hq-c"), msg(NOW - 100, "hq-a", "hq-b")], 0, NOW);
    expect(m.get("hq-a")?.peer).toBe("hq-b");
  });
});
