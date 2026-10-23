import { beforeAll, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async () => ({ ok: true, stdout: "\x1b[32m✓\x1b[0m lead mở\n✓ dev mở\n", stderr: "" })));
/** The live room's repo: a real temp dir (set in beforeAll), so the test runs the same on every OS. */
const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "@/app/api/team/route";
import { BoostButton, BoostChoices, boostOn, TeamControls, TeamStarter } from "@/components/hq/team-controls";
import { getToken } from "@/lib/server/auth";
import { pinnedRootsPath } from "@/lib/server/paths";
import { onePerBoard, type ProjectBoard } from "@/lib/server/board";
import { tail, teamArgs } from "@/lib/server/team";
import { BOOST_ONLY, BOOST_TEAM, DEFAULT_TEAM, emptyOfficeCopy, FULL_TEAM, teamText } from "@/lib/team-size";
import { ORIGIN, req, tempHome } from "./helpers";

const empty = { lanes: { backlog: [], ready: [], building: [], qa: [], review: [], approved: [], blocked: [] }, closed: [] } as unknown as ProjectBoard["board"];
const row = (root: string, filed: string | null, error: string | null = null): ProjectBoard => ({ root, name: root.split(/[\\/]/).pop()!, board: error ? null : empty, error, filed });

describe("onePerBoard", () => {
  it("keeps a repo nested in another repo as its own board (UAT: ai-game-studio inside 8sync-startup)", () => {
    const out = onePerBoard([row("C:\\s\\8sync-startup", "C:\\s\\8sync-startup"), row("C:\\s\\8sync-startup\\game\\ai-game-studio", "C:\\s\\8sync-startup\\game\\ai-game-studio")]);
    expect(out.map((b) => b.name).sort()).toEqual(["8sync-startup", "ai-game-studio"]);
  });

  it("folds a worktree into its repo's board, named after the repo", () => {
    const repo = "C:\\s\\game";
    const out = onePerBoard([row(`${repo}\\.claude\\worktrees\\card-5`, repo), row(repo, repo)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ root: repo, name: "game" });
    // Only the worktree has a room: it still speaks for the repo's board.
    const solo = onePerBoard([row(`${repo}\\.claude\\worktrees\\card-5`, repo)]);
    expect(solo).toMatchObject([{ root: `${repo}\\.claude\\worktrees\\card-5`, name: "game" }]);
  });

  it("matches Rust's canonical \\\\?\\ path on Windows to the room's own root", () => {
    const repo = "C:\\s\\game";
    const out = onePerBoard([row(`${repo}\\.claude\\worktrees\\card-5`, "\\\\?\\C:\\s\\game"), row(repo, "\\\\?\\C:\\s\\game")]);
    expect(out).toMatchObject([{ root: repo, name: "game" }]);
  });

  it("falls back to the outermost root when 8sync does not say where the board is filed", () => {
    const out = onePerBoard([row("/a", null), row("/a/b", null), row("/c", null, "8sync không trả lời")]);
    expect(out.map((b) => b.root)).toEqual(["/a", "/c"]);
  });
});

describe("team", () => {
  it("maps the buttons to auto up / up --clear-ss / down", () => {
    expect(teamArgs("up")).toEqual(["ccc", "auto", "up"]);
    expect(teamArgs("clean")).toEqual(["ccc", "auto", "up", "--clear-ss"]);
    expect(teamArgs("down")).toEqual(["ccc", "auto", "down"]);
    expect(teamArgs("full")).toEqual(["ccc", "auto", "up", "--roles", "full"]);
    expect(teamArgs("boost")).toEqual(["ccc", "auto", "up", "--roles", "boost", "--hours", "2"]);
    expect(teamArgs("unboost")).toEqual(["ccc", "auto", "down", "--only", "dev2,review"]);
    expect(tail("\x1b[1mone\x1b[0m\n\n two \n")).toBe("one\n two ");
  });

  it("knows the CLI's own default, full and boost teams (room.rs), so Tắt Sấm Sét stops exactly the boost-only rooms", () => {
    const rs = fs.readFileSync(path.join(import.meta.dirname, "../../../crates/cli/src/verbs/ccc/room.rs"), "utf8");
    const team = (name: string) => JSON.parse(rs.match(new RegExp(`const ${name}: \\[&str; \\d+\\] = (\\[[^\\]]*\\]);`))![1]) as string[];
    expect([...DEFAULT_TEAM]).toEqual(team("DEFAULT_TEAM"));
    expect([...FULL_TEAM]).toEqual(team("FULL_TEAM"));
    expect([...BOOST_TEAM]).toEqual(team("BOOST_TEAM"));
    expect(teamText(DEFAULT_TEAM)).toBe("3 phòng (lead, dev, qa)");
    expect(teamText(BOOST_TEAM)).toBe("5 phòng (lead, dev, dev2, qa, review)");
    expect(BOOST_ONLY).toEqual(["dev2", "review"]);
    // What stays after Tắt Sấm Sét is the default team, and boostOn flips off.
    const rooms = BOOST_TEAM.filter((r) => !BOOST_ONLY.includes(r)).map((n) => ({ name: n, label: n, status: "running" }));
    expect(rooms.map((r) => r.name)).toEqual([...DEFAULT_TEAM]);
    expect(boostOn(rooms)).toBe(false);
  });

  it("empty office: real buttons under the text; company mode says where the company team runs", () => {
    const open = emptyOfficeCopy({ repo: true, company: false, homes: [], starters: 1 });
    expect(open.title).toBe("Dự án này chưa có phòng nào chạy");
    expect(open.body).toContain("“Mở team” bên dưới: 3 phòng (lead, dev, qa)");
    expect(open.body).toContain("5 phòng (lead, dev, dev2, qa, review)");
    const co = emptyOfficeCopy({ repo: true, company: true, homes: ["platform"], starters: 1 });
    expect(co.title).toBe("Dự án này chưa có phòng riêng");
    expect(co.body).toContain("Team công ty đang chạy ở platform: các phòng đó nhận card của dự án này");
    expect(co.body).toContain("Mở team");
    expect(co.body).not.toContain("chưa có phòng nào chạy");
    expect(emptyOfficeCopy({ repo: false, company: false, homes: [], starters: 0 }).body).not.toContain("Bấm “Mở team”");
    for (const company of [false, true]) {
      const html = renderToStaticMarkup(createElement(TeamStarter, { projects: [{ path: "C:/p/zus", name: "zus" }], token: "t", company }));
      expect(html).toContain("Mở team (3 phòng: lead, dev, qa)");
      expect(html).toContain("Sấm Sét (5 phòng)");
    }
  });

  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-team-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    room.cwd = path.resolve(dir);
  });
  const post = (body: unknown) => POST(req("/api/team", { method: "POST", token, origin: ORIGIN, body }));

  it("runs only in a project HQ shows, in that root", async () => {
    // Case differs (Windows paths are case-insensitive): the run still uses the room's own spelling.
    const ok = await post({ root: room.cwd.toUpperCase(), action: "clean" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, output: "✓ lead mở\n✓ dev mở" });
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "up", "--clear-ss"], 300_000, room.cwd);
    run.mockClear();
    expect((await post({ root: path.join(os.tmpdir(), "not-a-project"), action: "up" })).status).toBe(409);
    expect((await post({ root: room.cwd, action: "rm -rf" })).status).toBe(422);
    expect(run).not.toHaveBeenCalled();
  });

  it("also runs in a pinned project with no room running (the sidebar shows it with its team buttons)", async () => {
    const pinned = fs.mkdtempSync(path.join(os.tmpdir(), "hq-team-pin-"));
    expect((await post({ root: pinned, action: "up" })).status).toBe(409);
    fs.mkdirSync(path.dirname(pinnedRootsPath()), { recursive: true });
    fs.writeFileSync(pinnedRootsPath(), JSON.stringify({ [pinned]: 1 }));
    run.mockClear();
    const ok = await post({ root: pinned, action: "up" });
    expect(ok.status).toBe(200);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "up"], 300_000, pinned);
    fs.rmSync(pinnedRootsPath());
  });

  it("refuses a second run in the same root while one is in flight (a second tab, a double click)", async () => {
    let finish: (v: unknown) => void = () => {};
    run.mockImplementationOnce(() => new Promise((r) => (finish = r)) as never);
    const first = post({ root: room.cwd, action: "clean" });
    await new Promise((r) => setTimeout(r, 10));
    const second = await post({ root: room.cwd, action: "up" });
    expect(second.status).toBe(409);
    expect((await second.json()).busy).toBe(true);
    finish({ ok: true, stdout: "done", stderr: "" });
    expect((await first).status).toBe(200);
    run.mockResolvedValueOnce({ ok: true, stdout: "again", stderr: "" });
    expect((await post({ root: room.cwd, action: "up" })).status).toBe(200);
  });

  it("Sấm Sét runs exactly `auto up --roles boost --hours 2` in the project root, turns on the ship sprint, then revives", async () => {
    run.mockClear();
    run.mockResolvedValueOnce({ ok: true, stdout: "✓ dev2 mở\n✓ review mở\nboost: 5 phòng · lease tới 18:00 UTC\n", stderr: "" });
    const ok = await post({ root: room.cwd.toUpperCase(), action: "boost" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).output.split("\n").at(-1)).toBe("boost: 5 phòng · lease tới 18:00 UTC");
    await new Promise((r) => setTimeout(r, 0));
    expect(run.mock.calls).toEqual([
      ["8sync", ["ccc", "auto", "up", "--roles", "boost", "--hours", "2"], 660_000, room.cwd],
      ["8sync", ["ccc", "auto", "ship-fast", "on", "--hours", "2", "--json"], 60_000, room.cwd],
      ["8sync", ["ccc", "auto", "revive"], 120_000],
    ]);
    // A failed boost reports the CLI's own error and revives nothing.
    run.mockClear();
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "boost: cửa sổ 5 giờ đã 90%" });
    const failed = await post({ root: room.cwd, action: "boost" });
    expect(failed.status).toBe(502);
    expect((await failed.json()).error).toBe("boost: cửa sổ 5 giờ đã 90%");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Sấm Sét is refused without the token, from a foreign origin or with no origin: nothing runs", async () => {
    run.mockClear();
    const body = { root: room.cwd, action: "boost" };
    expect((await POST(req("/api/team", { method: "POST", origin: ORIGIN, body }))).status).toBe(401);
    expect((await POST(req("/api/team", { method: "POST", token, origin: "http://evil.test", body }))).status).toBe(403);
    expect((await POST(req("/api/team", { method: "POST", token, body }))).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("Tắt Sấm Sét runs exactly `auto down --only <boost-only rooms>` in the project root, and nothing else", async () => {
    run.mockClear();
    run.mockResolvedValueOnce({ ok: true, stdout: "đã dừng phòng dev2\ncard #4 của dev2 trả về cột ready.\nCác phòng khác vẫn chạy.\n", stderr: "" });
    const ok = await post({ root: room.cwd.toUpperCase(), action: "unboost" });
    expect(ok.status).toBe(200);
    expect((await ok.json()).output).toContain("card #4 của dev2 trả về cột ready.");
    expect(run.mock.calls).toEqual([["8sync", ["ccc", "auto", "down", "--only", "dev2,review"], 180_000, room.cwd]]);
    run.mockClear();
    const body = { root: room.cwd, action: "unboost" };
    expect((await POST(req("/api/team", { method: "POST", origin: ORIGIN, body }))).status).toBe(401);
    expect((await POST(req("/api/team", { method: "POST", token, origin: "http://evil.test", body }))).status).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("UI: the Sấm Sét button asks first, shows the live boost team as active, and sits in the team controls", () => {
    const p = { root: room.cwd, name: "3d-game", token: "t" };
    const off = renderToStaticMarkup(createElement(BoostButton, { ...p, active: false }));
    for (const s of ["Sấm Sét", "5 phòng (lead, dev, dev2, qa, review)", "thêm dev2, review", "đội omp mặc định", "lease 2 giờ"]) expect(off).toContain(s);
    expect(off).not.toContain("13 phòng");
    expect(off).not.toContain("Đang Sấm Sét");
    const on = renderToStaticMarkup(createElement(BoostButton, { ...p, active: true }));
    for (const s of ["Đang Sấm Sét", "gia hạn thêm 2 giờ hoặc tắt", "bg-brand/25"]) expect(on).toContain(s);
    // Active: the dialog offers both, turning off first.
    const noop = () => {};
    const choices = renderToStaticMarkup(createElement(BoostChoices, { onOff: noop, onRenew: noop, onCancel: noop }));
    for (const s of ["Tắt Sấm Sét", "Gia hạn 2 giờ", "Thôi", "Giữ 5 phòng", "Về team 3 phòng (lead, dev, qa)", "auto down --only dev2,review", "auto up --roles boost --hours 2"]) expect(choices).toContain(s);
    // Owner 2026-10-22 "ui ux khó hiểu": the team actions fold behind "Thao tác team"; a live Sấm Sét stays in sight.
    const bar = renderToStaticMarkup(createElement(TeamControls, { ...p, boost: true }));
    for (const s of ["Đang Sấm Sét", "Ship card approved", "Thao tác team"]) expect(bar).toContain(s);
    for (const s of ["Mở lại team", "Team đầy đủ", "Dừng team"]) expect(bar).not.toContain(s);
    expect(renderToStaticMarkup(createElement(TeamControls, { ...p, boost: false }))).not.toContain("Sấm Sét</");

    const rooms = (names: readonly string[], status = "running") => names.map((n) => ({ name: n, label: n, status }));
    const boost = ["lead", "dev", "dev2", "qa", "review"];
    expect(boostOn(rooms(boost))).toBe(true);
    // omp rooms are `omp-<role>`; `auto up` titles a clashing room `<name>-<repo>`; HQ rooms are `hq-<repo>-<name>`, labelled `<repo> · <name>`.
    expect(boostOn(rooms(boost.map((n) => `omp-${n}`)))).toBe(true);
    expect(boostOn(rooms(boost.map((n) => `${n}-3d-game`)))).toBe(true);
    expect(boostOn(boost.map((n) => ({ name: `hq-3d-game-${n}`, label: `3d-game · ${n}`, status: "idle" })))).toBe(true);
    // Team đầy đủ also has dev2 and review, but its ui room says it is not Sấm Sét; the 3-room team is not either.
    expect(boostOn(rooms(FULL_TEAM))).toBe(false);
    expect(boostOn(rooms(DEFAULT_TEAM))).toBe(false);
    for (const only of BOOST_ONLY) expect(boostOn(rooms(boost.filter((n) => n !== only)))).toBe(false);
    expect(boostOn([...rooms(boost.slice(0, 4)), ...rooms(["review"], "ended")])).toBe(false);
  });
});
