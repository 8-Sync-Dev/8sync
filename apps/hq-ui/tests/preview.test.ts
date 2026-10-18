import { beforeAll, describe, expect, it, vi } from "vitest";

/** The live room's repo: a real temp dir (set in beforeAll), so the test runs the same on every OS. */
const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as list } from "@/app/api/preview/route";
import { GET as file } from "@/app/api/preview/file/route";
import { cardOf, groupByCard, mainRoot, rootKey, type PreviewItem } from "@/lib/preview";
import { getToken } from "@/lib/server/auth";
import { cachedPreview, PREVIEW_MAX_BYTES, previewId, resetPreviewIndex, scanProject } from "@/lib/server/preview";
import { req, tempHome } from "./helpers";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

function put(root: string, rel: string, data: Buffer = PNG, mtime?: number) {
  const f = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000);
  return f;
}

describe("preview helpers", () => {
  it("card id from the file name first, then the worktree; repo root of a worktree", () => {
    expect(cardOf("qa/evidence/card-7-home.png")).toBe(7);
    expect(cardOf(".claude/worktrees/card-9/qa/evidence/card-12-login.png")).toBe(12);
    expect(cardOf(".claude/worktrees/card-9/qa/evidence/home.png")).toBe(9);
    expect(cardOf("screenshots/discard-3.png")).toBeNull();
    expect(cardOf("screenshots/home.png")).toBeNull();
    expect(mainRoot("/r/app/.claude/worktrees/card-9")).toBe("/r/app");
    expect(mainRoot("C:\\r\\app\\.claude\\worktrees\\x\\sub")).toBe("C:\\r\\app");
    expect(rootKey("\\\\?\\C:\\R\\App\\")).toBe("c:/r/app");
  });

  it("groups by card, newest group first, items newest first", () => {
    const it = (card: number | null, mtime: number) => ({ id: String(mtime), card, mtime }) as PreviewItem;
    const g = groupByCard([it(7, 10), it(null, 50), it(7, 30), it(3, 20)]);
    expect(g.map((x) => x.card)).toEqual([null, 7, 3]);
    expect(g[1].items.map((x) => x.mtime)).toEqual([30, 10]);
  });
});

describe("scanProject", () => {
  let root = "";
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hq-preview-")));
    put(root, "qa/evidence/card-7-home.png", PNG, 3_000_000);
    put(root, "qa/evidence/a/b/c/deep.png", PNG, 2_000_000); // depth 3: kept
    put(root, "qa/evidence/a/b/c/d/too-deep.png"); // depth 4: skipped
    put(root, "qa/evidence/notes.txt", Buffer.from("x"));
    put(root, "docs/screenshots/home.webp", PNG, 1_000_000);
    put(root, "src/not-a-preview-folder.png");
    put(root, ".claude/worktrees/card-9/qa/evidence/login.png", PNG, 4_000_000);
    fs.writeFileSync(path.join(root, "qa/evidence/huge.png"), "");
    fs.truncateSync(path.join(root, "qa/evidence/huge.png"), PREVIEW_MAX_BYTES + 1);
  });

  it("lists images in the preview folders only, depth ≤ 3, ≤ 15 MB, newest first, with card and worktree", () => {
    const items = scanProject({ root, name: "app" });
    expect(items.map((i) => i.rel)).toEqual([
      ".claude/worktrees/card-9/qa/evidence/login.png",
      "qa/evidence/card-7-home.png",
      "qa/evidence/a/b/c/deep.png",
      "docs/screenshots/home.webp",
    ]);
    expect(items[0]).toMatchObject({ worktree: "card-9", card: 9, project: "app", root, size: PNG.length });
    expect(items[1]).toMatchObject({ worktree: null, card: 7 });
    expect(items[0].id).toMatch(/^[0-9a-f]{40}$/);
  });

  it("skips a link whose target leaves the root", () => {
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
    const rels = scanProject({ root, name: "app" }).map((i) => i.rel);
    expect(rels.some((r) => r.includes("escape") || r.startsWith("screenshots"))).toBe(false);
    expect(rels).toContain("qa/evidence/card-7-home.png");
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
    const { projects } = (await r.json()) as { projects: { root: string; items: PreviewItem[] }[] };
    expect(projects).toHaveLength(1);
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

  it("serves from the last listing without a rescan; a versioned URL is cached a day (owner 2026-10-18: Preview slow)", async () => {
    const r = await list(req("/api/preview", { token }));
    const item = ((await r.json()) as { projects: { items: PreviewItem[] }[] }).projects[0].items[0];
    expect(cachedPreview(item.id)?.abs).toBe(path.join(root, "qa", "evidence", "card-7-home.png"));
    expect(cachedPreview(previewId(path.join(root, "secret.png")))).toBeNull();
    expect(cachedPreview("../../secret.png")).toBeNull();
    expect(cachedPreview(item.id, Date.now() + 31_000)).toBeNull();
    const res = await file(req(`/api/preview/file?id=${item.id}&v=${Math.floor(item.mtime)}`, { token }));
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400, immutable");
    const odd = await file(req(`/api/preview/file?id=${item.id}&v=abc`, { token }));
    expect(odd.headers.get("cache-control")).toBe("private, max-age=60");
    // A file deleted since the listing is still a 404: the route checks the file before answering.
    fs.renameSync(path.join(root, "qa", "evidence", "card-7-home.png"), path.join(root, "qa", "gone.png"));
    expect((await file(req(`/api/preview/file?id=${item.id}`, { token }))).status).toBe(404);
    fs.renameSync(path.join(root, "qa", "gone.png"), path.join(root, "qa", "evidence", "card-7-home.png"));
    resetPreviewIndex();
  });
});
