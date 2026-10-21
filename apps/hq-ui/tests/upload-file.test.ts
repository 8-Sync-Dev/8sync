import { beforeAll, describe, expect, it, vi } from "vitest";

/** The live room's repo: a real temp dir (set in beforeAll), so placed copies are found through projectsInView. */
const room = vi.hoisted(() => ({ cwd: "" }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "s1", cwd: room.cwd, status: "running" }],
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as file } from "@/app/api/uploads/[id]/file/route";
import { parseAttachments } from "@/lib/attachments";
import { getToken } from "@/lib/server/auth";
import { findUpload, placeUploads, saveUpload, uploadsDir, withFiles } from "@/lib/server/uploads";
import { req, tempHome } from "./helpers";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("GET /api/uploads/[id]/file (chat thumbnails)", () => {
  let token = "";
  let root = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    root = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-upload-api-")));
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    room.cwd = root;
  });

  it("401 without the token", async () => {
    const up = saveUpload("a.png", PNG);
    expect((await file(req(`/api/uploads/${up.id}/file`), ctx(up.id))).status).toBe(401);
  });

  it("serves a staged image with its type, length and cache headers", async () => {
    const up = saveUpload("shot.png", PNG);
    const r = await file(req(`/api/uploads/${up.id}/file`, { token }), ctx(up.id));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-length")).toBe(String(PNG.length));
    expect(r.headers.get("cache-control")).toContain("private");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(PNG);
  });

  it("serves the copy placed in a known project after the staged one is gone", async () => {
    const up = saveUpload("placed.webp", PNG);
    const [p] = placeUploads([up.id], root);
    fs.rmSync(path.join(uploadsDir(), up.id), { recursive: true, force: true });
    const r = await file(req(`/api/uploads/${up.id}/file`, { token }), ctx(up.id));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/webp");
    // The path the room sees in the message round-trips to the same id.
    expect(parseAttachments(withFiles("xem", [p])).files).toEqual([{ id: up.id, name: "placed.webp", path: p }]);
  });

  it("422 for an id that is not 32 hex (traversal included), 404 for an unknown id or a non-image", async () => {
    for (const bad of ["..", "../../etc/passwd", "x".repeat(32), "0".repeat(31), "0".repeat(33), "A".repeat(32)]) {
      expect((await file(req(`/api/uploads/${encodeURIComponent(bad)}/file`, { token }), ctx(bad))).status).toBe(422);
    }
    expect((await file(req(`/api/uploads/${"0".repeat(32)}/file`, { token }), ctx("0".repeat(32)))).status).toBe(404);
    const pdf = saveUpload("brief.pdf", Buffer.from("%PDF-1.4"));
    expect((await file(req(`/api/uploads/${pdf.id}/file`, { token }), ctx(pdf.id))).status).toBe(404);
    // The finder never leaves the upload folders: a root is only a prefix for `.claude/hq-uploads/<id>`.
    expect(findUpload("0".repeat(32), [root])).toBeNull();
  });
});

describe("parseAttachments", () => {
  it("splits the body from upload paths in either slash style; keeps text whole when a line is not an upload", () => {
    const id = "a".repeat(32);
    const t = withFiles("sửa nút", [`C:\\w\\shop\\.claude\\hq-uploads\\${id}\\màn_hình.png`, `/home/me/shop/.claude/hq-uploads/${"b".repeat(32)}/brief.pdf`]);
    const r = parseAttachments(t);
    expect(r.body).toBe("sửa nút");
    expect(r.files.map((f) => [f.id, f.name])).toEqual([
      [id, "màn_hình.png"],
      ["b".repeat(32), "brief.pdf"],
    ]);
    expect(parseAttachments("chỉ chữ")).toEqual({ body: "chỉ chữ", files: [] });
    const odd = withFiles("x", ["C:\\elsewhere\\a.png"]);
    expect(parseAttachments(odd)).toEqual({ body: odd, files: [] });
    expect(parseAttachments(null).body).toBe("");
  });
});
