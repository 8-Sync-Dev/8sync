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
import { GET as meta } from "@/app/api/uploads/[id]/route";
import { GET as file } from "@/app/api/uploads/[id]/file/route";
import { mediaUrls, parseAttachments, splitUrls, uploadRefs } from "@/lib/attachments";
import { getToken } from "@/lib/server/auth";
import { findUpload, placeUploads, saveUpload, uploadSig, uploadSigValid, uploadsDir, withFiles } from "@/lib/server/uploads";
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

  it("422 for an id that is not 32 hex (traversal included), 404 for an unknown id", async () => {
    for (const bad of ["..", "../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "x".repeat(32), "0".repeat(31), "0".repeat(33), "A".repeat(32)]) {
      expect((await file(req(`/api/uploads/${encodeURIComponent(bad)}/file`, { token }), ctx(bad))).status).toBe(422);
      expect((await meta(req(`/api/uploads/${encodeURIComponent(bad)}`, { token }), ctx(bad))).status).toBe(422);
    }
    // A signed link cannot name a path either: the id is checked before the signature.
    expect((await file(req(`/api/uploads/..%2F..%2Fx/file?e=1&sig=${"0".repeat(64)}`), ctx("../../x"))).status).toBe(401);
    expect((await file(req(`/api/uploads/${"0".repeat(32)}/file`, { token }), ctx("0".repeat(32)))).status).toBe(404);
    // The finder never leaves the upload folders: a root is only a prefix for `.claude/hq-uploads/<id>`.
    expect(findUpload("0".repeat(32), [root])).toBeNull();
  });

  it("serves a non-media file only as a download, as octet-stream (an .html never renders on HQ's origin)", async () => {
    for (const name of ["bundle.zip", "page.html", "logo.svg"]) {
      const up = saveUpload(name, Buffer.from("PK\x03\x04 not really"));
      const r = await file(req(`/api/uploads/${up.id}/file`, { token }), ctx(up.id));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/octet-stream");
      expect(r.headers.get("content-disposition")).toBe(`attachment; filename="${name}"; filename*=UTF-8''${name}`);
    }
  });

  it("streams a video with its type; Range answers 206 with just that slice, out of the file 416", async () => {
    const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    const up = saveUpload("clip.mp4", bytes);
    const whole = await file(req(`/api/uploads/${up.id}/file`, { token }), ctx(up.id));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect(whole.headers.get("content-disposition")).toBeNull();
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(bytes);

    const part = req(`/api/uploads/${up.id}/file`, { token });
    part.headers.set("range", "bytes=100-199");
    const r = await file(part, ctx(up.id));
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(r.headers.get("content-length")).toBe("100");
    expect(Buffer.from(await r.arrayBuffer())).toEqual(bytes.subarray(100, 200));

    const tail = req(`/api/uploads/${up.id}/file`, { token });
    tail.headers.set("range", "bytes=-10");
    expect(Buffer.from(await (await file(tail, ctx(up.id))).arrayBuffer())).toEqual(bytes.subarray(990));

    const past = req(`/api/uploads/${up.id}/file`, { token });
    past.headers.set("range", "bytes=5000-");
    const r416 = await file(past, ctx(up.id));
    expect(r416.status).toBe(416);
    expect(r416.headers.get("content-range")).toBe("bytes */1000");
  });

  it("dl=1 saves the file under its own name, UTF-8 included", async () => {
    const up = saveUpload("màn hình.png", PNG);
    const r = await file(req(`/api/uploads/${up.id}/file?dl=1`, { token }), ctx(up.id));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="m_n_h_nh.png"; filename*=UTF-8''${encodeURIComponent("màn_hình.png")}`);
  });

  it("GET /api/uploads/[id] hands out a signed URL that works without the token; a wrong or stale signature is 401", async () => {
    const up = saveUpload("demo.webm", Buffer.from("webm-bytes"));
    expect((await meta(req(`/api/uploads/${up.id}`), ctx(up.id))).status).toBe(401);
    const m = (await (await meta(req(`/api/uploads/${up.id}`, { token }), ctx(up.id))).json()) as { name: string; kind: string; type: string; size: number; url: string };
    expect(m).toMatchObject({ name: "demo.webm", kind: "video", type: "video/webm", size: 10 });
    expect(m.url).toMatch(new RegExp(`^/api/uploads/${up.id}/file\\?e=\\d+&sig=[0-9a-f]{64}$`));
    expect(JSON.stringify(m)).not.toContain(uploadsDir());

    const ok = await file(req(m.url), ctx(up.id));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("webm-bytes");
    const dl = await file(req(`${m.url}&dl=1`), ctx(up.id));
    expect(dl.headers.get("content-disposition")).toContain('filename="demo.webm"');

    const other = saveUpload("other.webm", Buffer.from("x"));
    expect((await file(req(m.url.replace(up.id, other.id)), ctx(other.id))).status).toBe(401);
    expect((await file(req(m.url.slice(0, -1) + (m.url.endsWith("0") ? "1" : "0")), ctx(up.id))).status).toBe(401);
    const exp = Number(new URL(m.url, "http://x").searchParams.get("e"));
    expect(uploadSigValid(uploadSig(up.id, exp), up.id, exp, exp + 1)).toBe(false);
    expect(uploadSigValid(uploadSig(up.id, exp), up.id, exp, exp - 1000)).toBe(true);
  });
});

describe("chat link helpers", () => {
  it("splitUrls keeps sentence punctuation out of the link; mediaUrls picks image/video paths only", () => {
    const t = "xem https://cdn.x.io/a/shot.PNG?w=2, rồi https://x.io/v.mp4. và https://x.io/page (ok) ftp://no.pe/a.png";
    expect(splitUrls(t).filter((p) => p.url).map((p) => p.text)).toEqual(["https://cdn.x.io/a/shot.PNG?w=2", "https://x.io/v.mp4", "https://x.io/page"]);
    expect(splitUrls(t).map((p) => p.text).join("")).toBe(t);
    expect(mediaUrls(t)).toEqual([
      { url: "https://cdn.x.io/a/shot.PNG?w=2", kind: "image" },
      { url: "https://x.io/v.mp4", kind: "video" },
    ]);
    expect(mediaUrls("https://x.io/a.png https://x.io/a.png")).toHaveLength(1);
    expect(mediaUrls(null)).toEqual([]);
  });

  it("uploadRefs finds upload paths inside a reply", () => {
    const id = "c".repeat(32);
    expect(uploadRefs(`Đã đọc C:\\w\\.claude\\hq-uploads\\${id}\\clip.mp4. Xong, và lại /r/.claude/hq-uploads/${id}/clip.mp4`)).toEqual([
      { id, name: "clip.mp4", path: `\\.claude\\hq-uploads\\${id}\\clip.mp4` },
    ]);
    expect(uploadRefs("không có gì")).toEqual([]);
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

  it("several files reach the room numbered in the order added, and HQ reads the same order and paths back", () => {
    const paths = ["c", "a", "b"].map((ch) => `/r/.claude/hq-uploads/${ch.repeat(32)}/image.png`);
    const t = withFiles("ảnh 2 bị lệch", paths);
    expect(t.split("\n").slice(-3)).toEqual(paths.map((p, i) => `- ${i + 1}. ${p}`));
    expect(parseAttachments(t).files.map((f) => f.path)).toEqual(paths);
  });
});
