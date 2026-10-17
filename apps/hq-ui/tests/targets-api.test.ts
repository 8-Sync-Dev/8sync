import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const merged = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: merged,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/targets/route";
import { getToken } from "@/lib/server/auth";
import { addArgs, outermost, parseTargetBody } from "@/lib/server/targets";
import { ORIGIN, req, tempHome } from "./helpers";

/** A git repo dir (projectOf only looks for `.git` + HEAD on disk). */
function repo(dir: string): string {
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  return path.resolve(dir);
}

let token = "";
let base = "";
let shop = "";
let tools = "";
let nested = "";
beforeAll(() => {
  tempHome();
  token = getToken();
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hq-targets-"));
  shop = repo(path.join(base, "shop"));
  tools = repo(path.join(base, "tools"));
  nested = repo(path.join(shop, ".claude", "worktrees", "wt"));
});

const live = (name: string, cwd: string, status = "running") => ({ name, cwd, status });
/**
 * stdout of `8sync ccc auto add --json` as crates/cli/src/verbs/ccc/auto.rs prints it:
 * `json!({ "target": t, "position", "open", "sent": [{name, now}] })`, serde_json's sorted keys,
 * `Target` (target.rs) with its optional fields skipped when empty.
 */
const added = (id: number, sent: { name: string; now: boolean }[] = []) => ({
  ok: true,
  stdout: `{"open":1,"position":1,"sent":${JSON.stringify(sent)},"target":{"added":1792212000,"id":${id},"state":"open","text":"webhook 500 on retry"}}\n`,
  stderr: "",
});

beforeEach(() => {
  run.mockReset();
  merged.mockReset();
  merged.mockResolvedValue([live("rd", shop), live("web", path.join(shop, "apps", "web")), live("ops", tools), live("old", tools, "ended")]);
});

/**
 * `auto board --json` answers with the root its cards are filed under (target.rs filed_under: a
 * worktree inside shop files under shop); every other call takes the next `adds` reply in order.
 */
const boardOr = (adds: unknown[], filed = (cwd: string) => (cwd.startsWith(shop) && cwd !== shop && cwd.includes(".claude") ? shop : cwd)) => {
  const queue = [...adds];
  return async (_cmd: string, args: string[], _t: number, cwd: string) =>
    args.includes("board") ? { ok: true, stdout: JSON.stringify({ schema: 1, lanes: [], closed: [], issues: [], root: filed(cwd) }), stderr: "" } : queue.shift();
};
const addCwds = () => run.mock.calls.filter((c) => c[1].includes("add")).map((c) => c[3]).sort();

const post = (body: unknown, t: string | null = token) => POST(req("/api/targets", { method: "POST", token: t, origin: ORIGIN, body }));

describe("POST /api/targets", () => {
  it("401 without the token, runs nothing", async () => {
    expect((await post({ text: "x", root: shop }, null)).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("422 for bad bodies, runs nothing", async () => {
    for (const b of [
      {},
      { text: "", root: shop },
      { text: "x" },
      { text: 1, root: shop },
      { text: "a\x1b[201~b", root: shop },
      { text: "x", root: shop, now: "yes" },
      { text: "x", root: shop, check: "--now" },
      // 8sync itself only refuses "--"; a single dash is no command either.
      { text: "x", root: shop, check: "-x" },
      { text: "x", root: shop, check: "a\nb" },
      { text: "x", root: shop, check: "x".repeat(301) },
      { text: "x".repeat(2001), root: shop },
      { text: "x", root: "/".repeat(1025) },
    ]) {
      expect((await post(b)).status, JSON.stringify(b).slice(0, 80)).toBe(422);
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("409 for a folder with no live room: never runs in an arbitrary path", async () => {
    for (const root of [base, os.tmpdir(), path.join(tools, "..", "elsewhere")]) {
      expect((await post({ text: "x", root })).status, root).toBe(409);
    }
    // A subfolder of a live project is not a project root either.
    expect((await post({ text: "x", root: path.join(shop, "apps", "web") })).status).toBe(409);
    // A project whose rooms all ended has nobody to take the task.
    merged.mockResolvedValue([live("old", tools, "ended")]);
    expect((await post({ text: "x", root: tools })).status).toBe(409);
    merged.mockResolvedValue([]);
    expect((await post({ text: "x", root: "all" })).status).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs `auto add --json --now -- <text>` in the project root and reports the rooms reached", async () => {
    run.mockResolvedValueOnce(added(7, [{ name: "rd", now: true }, { name: "web", now: false }]));
    const res = await post({ text: "  webhook 500 on retry ", root: shop });
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "add", "--json", "--now", "--", "webhook 500 on retry"], 10_000, shop);
    expect(await res.json()).toEqual({
      results: [
        { root: shop, name: "shop", ok: true, id: 7, position: 1, open: 1, sent: [{ name: "rd", now: true }, { name: "web", now: false }], error: null },
      ],
    });
  });

  it("matches the root case-insensitively, like the office grouping", async () => {
    run.mockResolvedValueOnce(added(1));
    expect((await post({ text: "x", root: shop.toUpperCase() })).status).toBe(200);
    expect(run.mock.calls[0][3]).toBe(shop);
  });

  it("now:false only queues; check goes as its own argv; a flag-like text stays text", async () => {
    run.mockResolvedValueOnce(added(2));
    await post({ text: "--now rm -rf", root: tools, now: false, check: "pnpm test" });
    expect(run.mock.calls[0]).toEqual(["8sync", ["ccc", "auto", "add", "--json", "--check", "pnpm test", "--", "--now rm -rf"], 10_000, tools]);
  });

  it("all: one run per board, a worktree shares its repo's board", async () => {
    merged.mockResolvedValue([live("rd", shop), live("wt", nested), live("ops", tools)]);
    run.mockImplementation(boardOr([added(3), added(9)]));
    const res = await post({ text: "x", root: "all" });
    expect(res.status).toBe(200);
    expect(addCwds()).toEqual([shop, tools].sort());
    expect((await res.json()).results).toHaveLength(2);
  });

  it("all: a repo nested inside another repo has its own board and gets the card too", async () => {
    const game = repo(path.join(shop, "game"));
    merged.mockResolvedValue([live("rd", shop), live("lead", game)]);
    run.mockImplementation(boardOr([added(1), added(2)], (cwd) => cwd));
    const res = await post({ text: "x", root: "all" });
    expect(addCwds()).toEqual([shop, game].sort());
    expect((await res.json()).results).toHaveLength(2);
  });

  it("a failing 8sync is reported per project, not thrown", async () => {
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: hàng đã có 50 đích mở\n" });
    const res = await post({ text: "x", root: shop });
    expect(res.status).toBe(200);
    const [r] = (await res.json()).results;
    expect(r).toMatchObject({ ok: false, sent: [], error: "hàng đã có 50 đích mở" });
    run.mockResolvedValueOnce({ ok: true, stdout: "not json", stderr: "" });
    const [j] = (await (await post({ text: "x", root: shop })).json()).results;
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/8sync up/);
  });

  it("all: one project failing does not hide the ones that took it", async () => {
    run.mockImplementation(boardOr([added(4, [{ name: "rd", now: true }]), { ok: false, stdout: "", stderr: "Error: boom" }]));
    const { results } = await (await post({ text: "x", root: "all" })).json();
    expect(results.map((r: { ok: boolean }) => r.ok).sort()).toEqual([false, true]);
    expect(results.find((r: { ok: boolean }) => !r.ok).error).toBe("boom");
  });

  it("a timeout says the task may already be queued, so a resend is not blind", async () => {
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "", killed: true });
    const [r] = (await (await post({ text: "x", root: shop })).json()).results;
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/có thể đã vào hàng.*8sync ccc auto queue/);
  });
});

describe("lib/server/targets", () => {
  it("parse: CRLF to LF, now defaults to true, empty check is none", () => {
    expect(parseTargetBody({ text: "a\r\nb", root: "all", check: "" })).toEqual({ ok: true, value: { text: "a\nb", now: true, check: null, root: "all" } });
    expect(parseTargetBody(null)).toMatchObject({ ok: false });
  });
  it("addArgs puts every flag before `--`", () => {
    expect(addArgs({ text: "-x", now: true, check: "make" })).toEqual(["ccc", "auto", "add", "--json", "--now", "--check", "make", "--", "-x"]);
  });
  it("outermost keeps sibling roots and drops nested ones", () => {
    const p = (root: string) => ({ root, name: path.basename(root), branch: null });
    expect(outermost([p(shop), p(nested), p(tools)]).map((x) => x.root)).toEqual([shop, tools]);
  });
});
