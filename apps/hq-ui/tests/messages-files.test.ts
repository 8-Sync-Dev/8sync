import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendKeys = vi.hoisted(() => vi.fn<(session: string, text: string) => Promise<{ ok: boolean; stderr: string }>>(async () => ({ ok: true, stderr: "" })));
const merged = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn(async () => ({ ok: false, stdout: "", stderr: "no 8sync in tests" })));
const pane = vi.hoisted(() => ({ text: "❯ " }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  sendKeys,
  run,
  mergedSessions: merged,
  capturePlain: async () => pane.text,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST } from "@/app/api/messages/route";
import { getToken } from "@/lib/server/auth";
import { inboxFile } from "@/lib/server/inbox";
import { saveUpload } from "@/lib/server/uploads";
import { ORIGIN, req, tempHome } from "./helpers";

const SID = "0b3c9f2e-1a2b-4c3d-8e9f-0123456789ab";
let token = "";
let shop = "";
beforeAll(() => {
  tempHome();
  token = getToken();
  shop = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-msg-files-")));
  fs.mkdirSync(path.join(shop, ".git"), { recursive: true });
  fs.writeFileSync(path.join(shop, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.mkdirSync(path.join(shop, "apps", "web"), { recursive: true });
});

beforeEach(() => {
  sendKeys.mockClear();
  pane.text = "❯ ";
  merged.mockReset();
  merged.mockResolvedValue([
    { name: "hq-web", session_id: null, cwd: path.join(shop, "apps", "web"), status: "running", tmux: true },
    { name: SID, session_id: SID, cwd: shop, status: "idle", tmux: false },
  ]);
});

const post = (body: unknown) => POST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body }));
const placed = (id: string, name: string) => path.join(shop, ".claude", "hq-uploads", id, name);

describe("POST /api/messages with files", () => {
  it("inbox room: files land in <repo>/.claude/hq-uploads/<id>/ and the queued text names them", async () => {
    const a = saveUpload("shot.png", Buffer.from("png-bytes"));
    const b = saveUpload("note.txt", Buffer.from("hello"));
    const res = await post({ session: SID, text: "xem ảnh này", base: shop, files: [a.id, b.id] });
    expect(res.status).toBe(201);
    expect(fs.readFileSync(placed(a.id, "shot.png"), "utf8")).toBe("png-bytes");
    expect(fs.readFileSync(placed(b.id, "note.txt"), "utf8")).toBe("hello");
    expect(fs.readFileSync(path.join(shop, ".claude", "hq-uploads", ".gitignore"), "utf8")).toContain("*");
    const queued = JSON.parse(fs.readFileSync(inboxFile(SID), "utf8").trim().split("\n").pop()!).text as string;
    expect(queued).toContain("xem ảnh này");
    expect(queued).toContain(`- ${placed(a.id, "shot.png")}`);
    expect(queued).toContain(`- ${placed(b.id, "note.txt")}`);
  });

  it("terminal room in a sub folder: files go to its git root, typed text carries the paths", async () => {
    const a = saveUpload("pin.png", Buffer.from("x"));
    const res = await post({ session: "hq-web", text: "sửa nút này", files: [a.id] });
    expect(res.status).toBe(201);
    expect(fs.existsSync(placed(a.id, "pin.png"))).toBe(true);
    const typed = sendKeys.mock.calls[0]?.[1] as string;
    expect(typed).toMatch(/^sửa nút này\n\nFile đính kèm/);
    expect(typed).toContain(placed(a.id, "pin.png"));
  });

  it("400 for bad ids, too many files or a non-array; nothing placed or typed", async () => {
    const ok = saveUpload("a.png", Buffer.from("x")).id;
    for (const files of [["../etc"], ["ABC"], "x", [1], Array(6).fill(ok)]) {
      const res = await post({ session: SID, text: "x", files });
      expect(res.status).toBe(400);
    }
    expect(fs.existsSync(placed(ok, "a.png"))).toBe(false);
    expect(sendKeys).not.toHaveBeenCalled();
  });

  it("400 for an expired (unknown) id; 409 when the room is not live", async () => {
    expect((await post({ session: SID, text: "x", files: ["f".repeat(32)] })).status).toBe(400);
    const a = saveUpload("a.png", Buffer.from("x"));
    const gone = "hq-gone";
    const res = await post({ session: gone, text: "x", files: [a.id] });
    expect(res.status).toBe(409);
    expect(sendKeys).not.toHaveBeenCalled();
  });

  it("409 session-waiting places nothing; a retry after the dialog reuses one copy per id", async () => {
    const a = saveUpload("retry.png", Buffer.from("x"));
    const dir = path.join(shop, ".claude", "hq-uploads", a.id);
    pane.text = "   Teach auto mode about your environment?\n   ❯ Also scan shell history     true\n   ←/→ to change · Enter to continue · Esc to cancel";
    for (let i = 0; i < 3; i++) {
      const res = await post({ session: "hq-web", text: "x", files: [a.id] });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("session-waiting");
    }
    expect(fs.existsSync(dir)).toBe(false);
    expect(sendKeys).not.toHaveBeenCalled();
    pane.text = "❯ ";
    for (let i = 0; i < 2; i++) expect((await post({ session: "hq-web", text: "x", files: [a.id] })).status).toBe(201);
    expect(fs.readdirSync(dir)).toEqual(["retry.png"]);
    expect(sendKeys.mock.calls[1][1]).toContain(placed(a.id, "retry.png"));
  });

  it("no files: unchanged, no session lookup", async () => {
    const res = await post({ session: SID, text: "chỉ chữ" });
    expect(res.status).toBe(201);
    expect(merged).not.toHaveBeenCalled();
  });
});
