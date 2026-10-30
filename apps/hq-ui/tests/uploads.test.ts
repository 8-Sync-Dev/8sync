import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fileError, toBase64 } from "@/lib/attach";
import { placeUploads, safeName, saveUpload, UPLOAD_MAX, withFiles } from "@/lib/server/uploads";

const tmps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hq-uploads-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("composer attachments (owner 2026-10-18: gửi là phòng đọc được)", () => {
  it("names are safe on every OS: no path, no leading dot, Vietnamese kept, long names keep the extension", () => {
    expect(safeName("../../etc/passwd")).toBe("passwd");
    expect(safeName("C:\\Users\\me\\ảnh màn hình.png")).toBe("ảnh_màn_hình.png");
    expect(safeName(".env")).toBe("env");
    expect(safeName("...")).toBe("file");
    const long = safeName(`${"a".repeat(200)}.webp`);
    expect(long).toHaveLength(80);
    expect(long.endsWith(".webp")).toBe(true);
  });

  it("stages a file, then places it in the repo where Read can open it, never committed", () => {
    const stage = tmp();
    const repo = tmp();
    const up = saveUpload("shot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]), stage);
    expect(up).toMatchObject({ name: "shot.png", size: 4 });
    const [p] = placeUploads([up.id], repo, stage);
    expect(p).toBe(path.join(repo, ".claude", "hq-uploads", up.id, "shot.png"));
    expect(path.isAbsolute(p)).toBe(true);
    expect(fs.readFileSync(p)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(fs.readFileSync(path.join(repo, ".claude", "hq-uploads", ".gitignore"), "utf8")).toMatch(/^\*$/m);
    // A second project gets its own copy.
    const other = tmp();
    expect(fs.existsSync(placeUploads([up.id], other, stage)[0])).toBe(true);
  });

  it("refuses empty, oversized, unknown and expired files", () => {
    const stage = tmp();
    expect(() => saveUpload("a", Buffer.alloc(0), stage)).toThrow(/rỗng/);
    expect(() => saveUpload("a", Buffer.alloc(UPLOAD_MAX + 1), stage)).toThrow(/MB/);
    expect(() => placeUploads(["../x"], tmp(), stage)).toThrow();
    expect(() => placeUploads(["0".repeat(32)], tmp(), stage)).toThrow(/hết hạn/);
    const old = saveUpload("old.txt", Buffer.from("x"), stage, 0);
    fs.utimesSync(path.join(stage, old.id), new Date(0), new Date(0));
    saveUpload("new.txt", Buffer.from("y"), stage);
    expect(fs.existsSync(path.join(stage, old.id))).toBe(false);
  });

  it("the message lists the paths under the text", () => {
    expect(withFiles("fix nút", [])).toBe("fix nút");
    expect(withFiles("fix nút", ["/r/.claude/hq-uploads/a/x.png"])).toBe("fix nút\n\nFile đính kèm (mở bằng Read trước khi làm):\n- /r/.claude/hq-uploads/a/x.png");
  });

  it("the browser side checks size and encodes base64", async () => {
    expect(fileError({ name: "a.png", size: 0 })).toMatch(/rỗng/);
    expect(fileError({ name: "a.png", size: 11 * 1024 * 1024 })).toMatch(/10 MB/);
    expect(fileError({ name: "a.png", size: 10 })).toBeNull();
    expect(await toBase64(new Blob([Uint8Array.from([104, 105])]))).toBe("aGk=");
  });
});
