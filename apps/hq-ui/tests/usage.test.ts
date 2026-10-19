import fs from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/usage/route";
import { getToken } from "@/lib/server/auth";
import { projectDirName } from "@/lib/server/ask";
import { getDb } from "@/lib/server/db";
import { stateDir } from "@/lib/server/paths";
import {
  BYTES_PER_REQUEST,
  dayStart,
  FIVE_HOURS,
  readLimitSource,
  resetUsageCache,
  scanTranscripts,
  sumCalls,
  transcriptDirs,
  usageReport,
  windowStart,
  type UsageReport,
} from "@/lib/server/usage";
import { req, tempHome } from "./helpers";

const NOW = new Date(2026, 9, 19, 15, 0, 0).getTime();
const SID = "1eb79553-8369-4a90-b428-2dedb50e18db";
const SID2 = "9c4e39c6-43ee-4657-83ee-4baed6708855";
const s = (ms: number) => Math.floor(ms / 1000);

let home = "";
let repo = "";
let projects = "";

function line(id: string, ts: number, u: Partial<Record<"in" | "cr" | "cw" | "out", number>>, extra: Record<string, unknown> = {}): string {
  return (
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(ts).toISOString(),
      cwd: repo,
      sessionId: SID,
      message: {
        id,
        model: "claude-opus-5-5",
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: u.in ?? 0, cache_read_input_tokens: u.cr ?? 0, cache_creation_input_tokens: u.cw ?? 0, output_tokens: u.out ?? 0 },
      },
      ...extra,
    }) + "\n"
  );
}

function transcript(sid: string, body: string, dir = path.join(projects, projectDirName(repo))): string {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${sid}.jsonl`);
  fs.writeFileSync(f, body);
  fs.utimesSync(f, new Date(NOW), new Date(NOW));
  return f;
}

function append(f: string, body: string) {
  fs.appendFileSync(f, body);
  fs.utimesSync(f, new Date(NOW), new Date(NOW));
}

beforeAll(() => {
  home = tempHome();
  process.env.CLAUDE_CONFIG_DIR = path.join(home, ".claude");
  projects = path.join(home, ".claude", "projects");
  repo = path.join(home, "work", "shop");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
});

beforeEach(() => {
  resetUsageCache();
  fs.rmSync(projects, { recursive: true, force: true });
  fs.rmSync(path.join(stateDir(), "usage"), { recursive: true, force: true });
});

const dirs = () => transcriptDirs([repo], projects);

describe("transcript tokens", () => {
  it("dedupes content-block lines by message.id and sums usage", async () => {
    transcript(
      SID,
      line("msg_a", NOW - 60_000, { in: 3, cr: 1000, cw: 200, out: 10 }) +
        line("msg_a", NOW - 59_000, { in: 3, cr: 1000, cw: 200, out: 40 }) + // same call, later block
        line("msg_b", NOW - 30_000, { in: 5, cr: 2000, cw: 0, out: 7 }) +
        JSON.stringify({ type: "user", timestamp: new Date(NOW).toISOString(), message: { role: "user", content: "usage assistant" } }) +
        "\n" +
        line("msg_syn", NOW - 10_000, {}),
    );
    const { states } = await scanTranscripts(dirs(), dayStart(NOW));
    const t = sumCalls(states[0].calls.values(), dayStart(NOW));
    expect(t).toEqual({ input: 8, cache_read: 3000, cache_write: 200, output: 47, calls: 2, median_ctx: Math.round((1203 + 2005) / 2) });
  });

  it("reads only appended lines on the next request, and waits for a line to finish", async () => {
    const f = transcript(SID, line("msg_1", NOW - 60_000, { in: 1, out: 1 }));
    const first = await scanTranscripts(dirs(), dayStart(NOW));
    expect(first.read_bytes).toBe(fs.statSync(f).size);

    const again = await scanTranscripts(dirs(), dayStart(NOW));
    expect(again.read_bytes).toBe(0);

    const next = line("msg_2", NOW - 30_000, { in: 2, out: 2 });
    append(f, next + next.slice(0, 20)); // a complete line + one still being written
    const third = await scanTranscripts(dirs(), dayStart(NOW));
    expect(third.read_bytes).toBe(Buffer.byteLength(next));
    expect(third.pending_bytes).toBe(20);
    expect(sumCalls(third.states[0].calls.values(), 0).calls).toBe(2);

    append(f, next.slice(20)); // finishes the line: same id, deduped
    const fourth = await scanTranscripts(dirs(), dayStart(NOW));
    expect(fourth.pending_bytes).toBe(0);
    expect(sumCalls(fourth.states[0].calls.values(), 0).calls).toBe(2);
  });

  it("bounds the bytes read per request (8 MB by default) and continues on the next", async () => {
    expect(BYTES_PER_REQUEST).toBeLessThanOrEqual(8 * 1024 * 1024);
    let body = "";
    for (let i = 0; i < 50; i++) body += line(`msg_${i}`, NOW - 60_000 + i, { in: 1, out: 1 });
    transcript(SID, body);
    const a = await scanTranscripts(dirs(), dayStart(NOW), 2000);
    expect(a.read_bytes).toBeLessThanOrEqual(2000);
    expect(a.pending_bytes).toBeGreaterThan(0);
    let n = 0;
    while ((await scanTranscripts(dirs(), dayStart(NOW), 2000)).pending_bytes > 0 && n < 100) n++;
    const done = await scanTranscripts(dirs(), dayStart(NOW), 2000);
    expect(sumCalls(done.states[0].calls.values(), 0).calls).toBe(50);
  });

  it("runs overlapping requests one after the other, never reading a byte twice", async () => {
    let body = "";
    for (let i = 0; i < 40; i++) body += line(`msg_${i}`, NOW - 60_000 + i, { in: 1, out: 1 });
    const f = transcript(SID, body);
    const all = await Promise.all(Array.from({ length: 6 }, () => scanTranscripts(dirs(), dayStart(NOW), 1500)));
    expect(all.reduce((a, s) => a + s.read_bytes, 0)).toBeLessThanOrEqual(fs.statSync(f).size);
    const pending = all.map((s) => s.pending_bytes);
    expect(pending).toEqual([...pending].sort((a, b) => b - a));
    expect(new Set(pending).size).toBe(pending.length);
  });

  it("skips days of old history in a long transcript instead of parsing it", async () => {
    const old = line("msg_old", NOW - 3 * 86_400_000, { in: 1, out: 1 }, { pad: "x".repeat(4000) });
    let body = "";
    let i = 0;
    while (Buffer.byteLength(body) < 6 * 1024 * 1024) body += old.replace("msg_old", `msg_old${i++}`);
    body += line("msg_new", NOW - 60_000, { in: 9, out: 9 });
    transcript(SID, body);
    const r = await scanTranscripts(dirs(), dayStart(NOW));
    expect(r.read_bytes).toBeLessThan(2 * 1024 * 1024);
    const t = sumCalls(r.states[0].calls.values(), 0);
    expect(t.calls).toBe(1);
    expect(t.input).toBe(9);
  });

  it("finds the project folder and its worktrees, not a sibling repo", () => {
    for (const d of [repo, path.join(repo, ".claude", "worktrees", "card-1"), repo + "-web"])
      fs.mkdirSync(path.join(projects, projectDirName(d)), { recursive: true });
    expect(dirs().map((d) => path.basename(d)).sort()).toEqual(
      [projectDirName(repo), projectDirName(path.join(repo, ".claude", "worktrees", "card-1"))].sort(),
    );
  });
});

describe("plan windows", () => {
  it("starts the 5-hour window 5 h before its reset, else the last 5 h", () => {
    expect(windowStart({ five_hour_resets_at: s(NOW + 2 * 3_600_000) }, NOW)).toBe(s(NOW + 2 * 3_600_000) * 1000 - FIVE_HOURS);
    expect(windowStart({ five_hour_resets_at: s(NOW - 1000) }, NOW)).toBe(NOW - FIVE_HOURS);
    expect(windowStart(null, NOW)).toBe(NOW - FIVE_HOURS);
  });

  it("names the session the limits came from", () => {
    const dir = path.join(stateDir(), "usage");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID2}.json`), JSON.stringify({ session_id: SID2, cwd: repo, model: "claude-opus-5-5", ts: s(NOW) }));
    const f = path.join(dir, `${SID}.json`);
    fs.writeFileSync(
      f,
      JSON.stringify({ session_id: SID, cwd: repo, model: "claude-opus-5-5", five_hour_pct: 91, five_hour_resets_at: s(NOW + 3_600_000), seven_day_pct: 40, ts: s(NOW) }),
    );
    fs.utimesSync(f, new Date(NOW - 5000), new Date(NOW - 5000));
    expect(readLimitSource()).toMatchObject({ five_hour_pct: 91, seven_day_pct: 40, session_id: SID, project: "shop", model: "claude-opus-5-5" });
  });

  it("counts a call in today but not in a window that started after it", async () => {
    const dir = path.join(stateDir(), "usage");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID}.json`), JSON.stringify({ session_id: SID, five_hour_pct: 50, five_hour_resets_at: s(NOW + 3 * 3_600_000) }));
    // window = [NOW - 2h, NOW + 3h)
    transcript(SID, line("msg_early", NOW - 3 * 3_600_000, { in: 100 }) + line("msg_late", NOW - 3_600_000, { in: 7 }));
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO sessions(name, cwd, updated_at) VALUES (?, ?, ?)").run(SID, repo, NOW);
    db.prepare("INSERT OR REPLACE INTO session_alias(session_id, name) VALUES (?, ?)").run(SID, "hq-core");
    const r = await usageReport(db, NOW);
    expect(r.window_start).toBe(s(NOW + 3 * 3_600_000) * 1000 - FIVE_HOURS);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ key: "hq-core", session_id: SID, label: "core", project: { name: "shop", branch: "main" } });
    expect(r.rows[0].today.input).toBe(107);
    expect(r.rows[0].window.input).toBe(7);
    expect(r.totals.today.input).toBe(107);
  });

  it("adds a session's subagent transcripts to its room and dedupes a forked copy", async () => {
    const dir = path.join(projects, projectDirName(repo));
    transcript(SID, line("msg_main", NOW - 60_000, { in: 1, out: 1 }));
    const sub = path.join(dir, SID, "subagents");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "agent-1.jsonl"), line("msg_sub", NOW - 50_000, { in: 10, out: 10 }));
    fs.utimesSync(path.join(sub, "agent-1.jsonl"), new Date(NOW), new Date(NOW));
    // A resumed session copies the history (same message ids) into a new file.
    transcript(SID2, line("msg_main", NOW - 60_000, { in: 1, out: 1 }) + line("msg_fork", NOW - 1000, { in: 100 }));
    fs.utimesSync(path.join(dir, `${SID2}.jsonl`), new Date(NOW + 1000), new Date(NOW + 1000));
    const db = getDb();
    db.prepare("INSERT OR REPLACE INTO sessions(name, cwd, updated_at) VALUES (?, ?, ?)").run(SID, repo, NOW);
    const r = await usageReport(db, NOW);
    const one = r.rows.find((x) => x.session_id === SID)!;
    const two = r.rows.find((x) => x.session_id === SID2)!;
    expect(one.today.input).toBe(11);
    expect(two.today.input).toBe(100);
    expect(r.totals.today.input).toBe(111);
    expect(r.totals.today.calls).toBe(3);
  });
});

describe("GET /api/usage", () => {
  it("needs the token", async () => {
    expect((await GET(req("/api/usage"))).status).toBe(401);
  });

  it("answers windows, rows and totals", async () => {
    const dir = path.join(stateDir(), "usage");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${SID}.json`), JSON.stringify({ session_id: SID, cwd: repo, five_hour_pct: 12, seven_day_pct: 3 }));
    transcript(SID, line("msg_x", Date.now() - 1000, { in: 4, cr: 6, out: 2 }));
    getDb().prepare("INSERT OR REPLACE INTO sessions(name, cwd, updated_at) VALUES (?, ?, ?)").run(SID, repo, Date.now());
    const res = await GET(req("/api/usage", { token: getToken() }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const v = (await res.json()) as UsageReport;
    expect(v.limits).toMatchObject({ five_hour_pct: 12, seven_day_pct: 3, session_id: SID });
    expect(v.rows.map((r) => [r.session_id, r.today.input, r.today.cache_read, r.today.output])).toEqual([[SID, 4, 6, 2]]);
    expect(v.totals.window.calls).toBe(1);
    expect(v.rest_pct).toBe(90);
    expect(v.scan.pending_bytes).toBe(0);
  });
});
