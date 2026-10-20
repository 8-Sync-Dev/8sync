import { beforeAll, describe, expect, it, vi } from "vitest";

/** The live room's repo: a real temp dir (set in beforeAll), so the test runs the same on every OS. */
const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as list } from "@/app/api/preview/route";
import { GET as file } from "@/app/api/preview/file/route";
import type { Board, Card, Closed, LaneKey } from "@/lib/lanes";
import { cardOf, mainRoot, previewSections, rootKey, worktreeCard, type PreviewItem } from "@/lib/preview";
import { getToken } from "@/lib/server/auth";
import { inPreviewDir, openPreview, parseLogTimes, parseStatus, PREVIEW_MAX_BYTES, previewId, scanProject } from "@/lib/server/preview";
import { req, tempHome } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
/** A PNG with a different size: a distinct image to the dedupe. */
const png = (n: number) => Buffer.concat([PNG, Buffer.alloc(n)]);

function put(root: string, rel: string, data: Buffer = PNG, mtime?: number) {
  const f = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}

/** git with a fixed identity; `at` (s) pins both commit dates. */
function git(cwd: string, args: string[], at?: number) {
  const date = at ? { GIT_AUTHOR_DATE: `${at} +0000`, GIT_COMMITTER_DATE: `${at} +0000` } : {};
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    env: { ...process.env, ...date, GIT_TERMINAL_PROMPT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  }).toString();
}

describe("preview helpers", () => {
  it("card id from the file name first, then the folders; a worktree's card from its branch, else its folder", () => {
    expect(cardOf("qa/evidence/card-7-home.png")).toBe(7);
    expect(cardOf("qa/evidence/card7.png")).toBe(7);
    expect(cardOf("qa/evidence/card-12/home.png")).toBe(12);
    expect(cardOf(".claude/worktrees/card-9/qa/evidence/card-12-login.png")).toBe(12);
    expect(cardOf(".claude/worktrees/card-9/qa/evidence/home.png")).toBe(9);
    expect(cardOf("screenshots/discard-3.png")).toBeNull();
    expect(cardOf("screenshots/home.png")).toBeNull();
    // Folders get reused: card-11's folder now builds card 22.
    expect(worktreeCard("card-11-pbr-realism", "card-22-capacitor-android-r2")).toBe(22);
    expect(worktreeCard("card-6", "a1b2c3d")).toBe(6);
    expect(worktreeCard("qa", null)).toBeNull();
    expect(mainRoot("/r/app/.claude/worktrees/card-9")).toBe("/r/app");
    expect(mainRoot("C:\\r\\app\\.claude\\worktrees\\x\\sub")).toBe("C:\\r\\app");
    expect(rootKey("\\\\?\\C:\\R\\App\\")).toBe("c:/r/app");
  });

  it("reads git log times (newest commit per path), status paths and preview-folder tree paths", () => {
    const t = parseLogTimes("@@300\n\nqa/evidence/a.png\r\n@@200\n\nqa/evidence/a.png\nqa/evidence/b.png\n");
    expect([...t.times]).toEqual([
      ["qa/evidence/a.png", 300_000],
      ["qa/evidence/b.png", 200_000],
    ]);
    expect(t).toMatchObject({ oldest: 200_000, commits: 2 });
    expect(parseStatus(" M qa/evidence/a.png\0?? qa/evidence/new.png\0R  qa/evidence/n.png\0qa/evidence/o.png\0!! evidence/tmp/\0")).toEqual([
      "qa/evidence/a.png",
      "qa/evidence/new.png",
      "qa/evidence/n.png",
      "evidence/tmp/",
    ]);
    expect(inPreviewDir("qa/evidence/a/b/c/x.png")).toBe(true);
    expect(inPreviewDir("qa/evidence/a/b/c/d/x.png")).toBe(false);
    expect(inPreviewDir("qa/evidence/.hidden/x.png")).toBe(false);
    expect(inPreviewDir("qa/evidence/notes.txt")).toBe(false);
    expect(inPreviewDir("src/x.png")).toBe(false);
  });
});

describe("previewSections", () => {
  const H = 3600_000;
  const now = 100 * H;
  const shot = (id: string, card: number | null, at: number) => ({ id, card, at }) as PreviewItem;
  const card = (id: number, lane: LaneKey, at: number): Card => ({
    id,
    text: `card ${id}`,
    lane,
    check: null,
    label: null,
    claim: null,
    pr: null,
    sha: null,
    bounces: 0,
    note: { room: "dev", text: "x", at },
    added: 0,
  });
  const closed = (id: number, at: number): Closed => ({ id, text: `card ${id}`, state: "done", by: null, at });
  const board: Board = {
    lanes: {
      backlog: [card(1, "backlog", 99 * H)],
      ready: [],
      building: [card(2, "building", 10 * H), card(3, "building", 50 * H)],
      qa: [card(4, "qa", 90 * H)],
      review: [],
      approved: [card(5, "approved", 1 * H)],
      blocked: [],
    },
    closed: [closed(6, 20 * H), closed(7, 95 * H), { ...closed(8, 99 * H), state: "dropped" }],
  };

  it("Đang làm: lane by lane, most recent activity first; Xong: last closed first; Khác: the rest, newest first", () => {
    const items = [shot("a", 3, 5 * H), shot("b", 3, 40 * H), shot("c", 7, 30 * H), shot("d", null, 60 * H), shot("e", 1, 70 * H), shot("f", 99, 10 * H)];
    const s = previewSections(items, board, now);
    expect(s.working.map((w) => w.card.id)).toEqual([3, 2, 4, 5]);
    expect(s.working[0].items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(s.working[1].items).toEqual([]);
    expect(s.done.map((d) => d.card.id)).toEqual([7, 6]);
    expect(s.done[0].items.map((i) => i.id)).toEqual(["c"]);
    // Unassigned, a backlog card's and an unknown card's shots.
    expect(s.other.map((i) => i.id)).toEqual(["e", "d", "f"]);
    expect(s.done24h).toBe(1);
  });

  it("without a board every image is Khác", () => {
    const s = previewSections([shot("a", 3, 1), shot("b", null, 2)], null, now);
    expect(s).toMatchObject({ working: [], done: [], done24h: 0 });
    expect(s.other.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("scanProject outside git", () => {
  let root = "";
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-preview-")));
    put(root, "qa/evidence/card-7-home.png", PNG, 3_000_000);
    put(root, "qa/evidence/a/b/c/deep.png", png(1), 2_000_000); // depth 3: kept
    put(root, "qa/evidence/a/b/c/d/too-deep.png"); // depth 4: skipped
    put(root, "qa/evidence/notes.txt", Buffer.from("x"));
    put(root, "docs/screenshots/home.webp", png(2), 1_000_000);
    put(root, "src/not-a-preview-folder.png");
    put(root, ".claude/worktrees/card-9/qa/evidence/login.png", png(3), 4_000_000);
    fs.writeFileSync(path.join(root, "qa/evidence/huge.png"), "");
    fs.truncateSync(path.join(root, "qa/evidence/huge.png"), PREVIEW_MAX_BYTES + 1);
  });

  it("lists images in the preview folders only, depth ≤ 3, ≤ 15 MB, by mtime, with card and worktree", async () => {
    const items = await scanProject({ root, name: "app" });
    expect(items.map((i) => i.rel)).toEqual([
      ".claude/worktrees/card-9/qa/evidence/login.png",
      "qa/evidence/card-7-home.png",
      "qa/evidence/a/b/c/deep.png",
      "docs/screenshots/home.webp",
    ]);
    expect(items[0]).toMatchObject({ worktree: "card-9", card: 9, project: "app", root, size: PNG.length + 3, timeFrom: "file", at: 4_000_000, ref: null });
    expect(items[1]).toMatchObject({ worktree: null, card: 7 });
    expect(items[0].id).toMatch(/^[0-9a-f]{40}$/);
  });

  it("skips a link whose target leaves the root", async () => {
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-preview-out-")));
    put(outside, "secret.png");
    let made = 0;
    // A folder link (a junction needs no privilege on Windows), then a file link (needs one there).
    for (const [target, at, type] of [
      [outside, "screenshots", "junction"],
      [path.join(outside, "secret.png"), "qa/evidence/escape.png", "file"],
    ] as const) {
      try {
        fs.symlinkSync(target, path.join(root, ...at.split("/")), type);
        made++;
      } catch {
        /* no symlink privilege for this kind */
      }
    }
    expect(made).toBeGreaterThan(0);
    const rels = (await scanProject({ root, name: "app" })).map((i) => i.rel);
    expect(rels.some((r) => r.includes("escape") || r.startsWith("screenshots"))).toBe(false);
    expect(rels).toContain("qa/evidence/card-7-home.png");
  });
});

describe("scanProject in a git repo with worktrees", () => {
  // Commit times (s); every file a checkout writes gets a fresh mtime, far newer than these.
  const T_OLD = 1_700_000_000;
  const T_CARD7 = 1_700_100_000;
  const T_MAIN = 1_700_200_000;
  const NEW = Date.now() - 60_000;
  let root = "";
  const byRel = async () => new Map((await scanProject({ root, name: "app" })).map((i) => [i.rel, i]));

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-preview-git-")));
    git(root, ["init", "-q", "-b", "main"]);
    put(root, "qa/evidence/card-5-old.png");
    put(root, "qa/evidence/shared.png", png(4));
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "card 5"], T_OLD);
    // A card-7 worktree: the checkout rewrites card-5-old.png and shared.png with fresh mtimes.
    git(root, ["worktree", "add", "-q", "-b", "card-7-feature", ".claude/worktrees/card-7"]);
    const wt7 = path.join(root, ".claude", "worktrees", "card-7");
    put(wt7, "qa/evidence/card-7-done.png", png(7));
    git(wt7, ["add", "-A"]);
    git(wt7, ["commit", "-q", "-m", "card 7"], T_CARD7);
    put(wt7, "qa/evidence/home.png", png(8), NEW); // untracked, unassigned: card 7's new shot
    put(wt7, "qa/evidence/card-6-other.png", png(9), NEW); // another card's: not this worktree's
    // A detached qa worktree holds the same card-5 file again.
    git(root, ["worktree", "add", "-q", "--detach", ".claude/worktrees/qa"]);
    // In the root: an untracked copy of card 7's committed shot, and a brand-new untracked shot.
    put(root, "qa/evidence/card-7-done.png", png(7), NEW);
    put(root, "qa/evidence/card-8-new.png", png(10), NEW - 1000);
    // origin/main moved ahead with a shot no checkout has.
    git(root, ["checkout", "-q", "-b", "upstream"]);
    put(root, "qa/evidence/card-9-merged.png", png(11));
    git(root, ["add", "qa/evidence/card-9-merged.png"]);
    git(root, ["commit", "-q", "-m", "card 9"], T_MAIN);
    git(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    git(root, ["checkout", "-q", "main"]);
    git(root, ["branch", "-q", "-D", "upstream"]);
    fs.rmSync(path.join(root, "qa", "evidence", "card-9-merged.png"), { force: true });
    // Touch the tracked file: its time must not move.
    fs.utimesSync(path.join(root, "qa", "evidence", "card-5-old.png"), new Date(), new Date());
  });

  it("a tracked, unmodified image keeps its commit time even after a checkout or a touch", async () => {
    const m = await byRel();
    expect(m.get("qa/evidence/card-5-old.png")).toMatchObject({ card: 5, at: T_OLD * 1000, timeFrom: "commit", worktree: null });
  });

  it("an untracked new image uses its mtime", async () => {
    expect((await byRel()).get("qa/evidence/card-8-new.png")).toMatchObject({ card: 8, at: NEW - 1000, timeFrom: "file" });
  });

  it("a modified tracked image uses its mtime", async () => {
    put(root, "qa/evidence/shared.png", png(5), NEW + 5000);
    try {
      expect((await byRel()).get("qa/evidence/shared.png")).toMatchObject({ at: NEW + 5000, timeFrom: "file" });
    } finally {
      put(root, "qa/evidence/shared.png", png(4));
      git(root, ["checkout", "-q", "--", "qa/evidence/shared.png"]);
    }
  });

  it("a card worktree shows only its card: its commits and its new unassigned shots, never the repo's other images", async () => {
    const wt = [...(await byRel()).values()].filter((i) => i.worktree === "card-7");
    expect(wt.map((i) => i.rel).sort()).toEqual([".claude/worktrees/card-7/qa/evidence/card-7-done.png", ".claude/worktrees/card-7/qa/evidence/home.png"]);
    expect(wt.find((i) => i.rel.endsWith("home.png"))).toMatchObject({ card: 7, timeFrom: "file", at: NEW, branch: "card-7-feature" });
  });

  it("one image across checkouts is listed once, its commit time beating a copy's mtime", async () => {
    const items = await scanProject({ root, name: "app" });
    expect(items.filter((i) => i.rel.endsWith("card-5-old.png"))).toHaveLength(1);
    expect(items.filter((i) => i.rel.endsWith("shared.png"))).toHaveLength(1);
    const seven = items.filter((i) => i.rel.endsWith("card-7-done.png"));
    expect(seven).toHaveLength(1);
    expect(seven[0]).toMatchObject({ worktree: "card-7", at: T_CARD7 * 1000, timeFrom: "commit" });
  });

  it("reads an image only the main tip has from git, and serves it by its id", async () => {
    const nine = (await scanProject({ root, name: "app" })).find((i) => i.rel === "qa/evidence/card-9-merged.png");
    expect(nine).toMatchObject({ ref: "origin/main", card: 9, at: T_MAIN * 1000, timeFrom: "commit", worktree: null });
    const hit = await openPreview(nine!.id, [{ root, name: "app", branch: "main" }]);
    expect(hit?.type).toBe("image/png");
    expect(Buffer.from(hit!.body as Uint8Array).equals(png(11))).toBe(true);
  });

  it("newest true time first: untracked new shots, then commits by date", async () => {
    // shared.png shares card-5-old's commit: a tie, left out of the order.
    const order = (await scanProject({ root, name: "app" })).map((i) => i.rel.split("/").pop()).filter((n) => n !== "shared.png");
    expect(order).toEqual(["home.png", "card-8-new.png", "card-9-merged.png", "card-7-done.png", "card-5-old.png"]);
  });
});

describe("GET /api/preview and /api/preview/file", () => {
  let token = "";
  let root = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    root = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-preview-api-")));
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    put(root, "qa/evidence/card-7-home.png");
    put(root, "secret.png");
    room.cwd = root;
  });

  it("401 without the token on both routes", async () => {
    expect((await list(req("/api/preview"))).status).toBe(401);
    expect((await file(req(`/api/preview/file?id=${"0".repeat(40)}`))).status).toBe(401);
  });

  it("lists the live project's images and serves one by its id with safe headers", async () => {
    const r = await list(req("/api/preview", { token }));
    expect(r.status).toBe(200);
    const { projects } = (await r.json()) as { projects: { root: string; main: unknown; items: PreviewItem[] }[] };
    expect(projects).toHaveLength(1);
    expect(projects[0].main).toBeNull();
    expect(projects[0].items.map((i) => i.rel)).toEqual(["qa/evidence/card-7-home.png"]);
    const res = await file(req(`/api/preview/file?id=${projects[0].items[0].id}`, { token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, max-age=60");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("404 for anything that is not a listed id: paths, traversal, the id of a file outside the folders", async () => {
    const ids = [
      "../../secret.png",
      encodeURIComponent(path.join(root, "secret.png")),
      "..%2F..%2Fetc%2Fpasswd",
      previewId(path.join(root, "secret.png")),
      crypto.createHash("sha1").update("nope").digest("hex"),
      "",
    ];
    for (const id of ids) expect((await file(req(`/api/preview/file?id=${id}`, { token }))).status).toBe(404);
    expect((await file(req("/api/preview/file", { token }))).status).toBe(404);
  });
});
