import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendKeys = vi.hoisted(() => vi.fn<(session: string, text: string) => Promise<{ ok: boolean; stderr: string }>>(async () => ({ ok: true, stderr: "" })));
const merged = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  sendKeys,
  run,
  mergedSessions: merged,
  capturePlain: async () => "❯ ",
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { POST as digestPOST } from "@/app/api/digest/route";
import { POST as factsPOST } from "@/app/api/facts/route";
import { POST as messagesPOST } from "@/app/api/messages/route";
import { getToken } from "@/lib/server/auth";
import { senderRoomOf } from "@/lib/server/brief";
import { resetFloorCache } from "@/lib/server/floor";
import type { Room } from "@/lib/server/office";
import { ORIGIN, req, tempHome } from "./helpers";

// One folder, three rooms (the 0.139.0 UAT: 8sync-startup runs coding, mkt and game-studio):
// two omp rooms and a Claude Code room in a subfolder; a tmux room elsewhere receives the sends.
const SID = "7c0ffee0-1a2b-4c3d-8e9f-0123456789ab";
const CODING = "omp-00000000000000c1";
const MKT = "omp-00000000000000c2";

describe("senderRoomOf: named ids decide alone", () => {
  const room = (name: string, session_id: string | null, cwd: string) => ({ name, session_id, cwd }) as Pick<Room, "name" | "session_id" | "cwd">;
  const rooms = [room(SID, SID, "/w/shop/clean"), room(CODING, CODING, "/w/shop"), room(MKT, MKT, "/w/shop"), room("hq-web", null, "/w/site")];

  it("a Claude Code id or an omp room id names its room; the folder only without any id, and only when one room works there", () => {
    expect(senderRoomOf(rooms, { ids: [SID] }, "hq-web")?.name).toBe(SID);
    expect(senderRoomOf(rooms, { ids: [undefined, CODING], cwd: "/w/shop" }, "hq-web")?.name).toBe(CODING);
    expect(senderRoomOf(rooms, { ids: ["gone-id", MKT] }, "hq-web")?.name, "an unknown id beside a known one").toBe(MKT);
    expect(senderRoomOf(rooms, { cwd: "/w/shop" }, "hq-web"), "two rooms there: never the first").toBeNull();
    expect(senderRoomOf(rooms, { cwd: "/w/shop/clean" }, "hq-web")?.name).toBe(SID);
  });

  it("refuses an id no live room has (even with a one-room folder), two ids naming two rooms, and the recipient", () => {
    expect(senderRoomOf(rooms, { ids: ["omp-ffffffffffffffff"], cwd: "/w/shop/clean" }, "hq-web")).toBeNull();
    expect(senderRoomOf(rooms, { ids: [SID, CODING] }, "hq-web")).toBeNull();
    expect(senderRoomOf(rooms, { ids: [CODING] }, CODING)).toBeNull();
  });
});

describe("routes: who calls digest / fact / send", () => {
  let token = "";
  let shop = "";
  let site = "";
  let codingDir = "";
  beforeAll(() => {
    const home = tempHome();
    token = getToken();
    shop = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-caller-shop-")));
    site = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-caller-site-")));
    fs.mkdirSync(path.join(shop, "clean"));
    const sessions = path.join(home, "sessions", "shop");
    codingDir = path.join(sessions, "coding");
    for (const d of [codingDir, path.join(sessions, "mkt")]) fs.mkdirSync(d, { recursive: true });
  });
  beforeEach(() => {
    resetFloorCache();
    sendKeys.mockClear();
    merged.mockResolvedValue([
      { name: "hq-web", label: "web", session_id: null, cwd: site, status: "idle", tmux: true, source: "tmux", detail: null, inbox_live: false },
      { name: SID, label: "clean", session_id: SID, cwd: path.join(shop, "clean"), status: "running", tmux: false, source: "claude", detail: "Dọn ổ đĩa", inbox_live: false },
    ]);
    const now = Math.floor(Date.now() / 1000) - 30;
    const omp = (name: string, id: string) => ({ engine: "omp", name, inbox_id: id, repo: shop, status: "running", last_active: now, transcript: path.join(path.dirname(codingDir), name, `2026-11-08T00-00-00-000Z_01a1${name}.jsonl`) });
    run.mockResolvedValue({ ok: true, stdout: JSON.stringify([omp("coding", CODING), omp("mkt", MKT)]), stderr: "" });
  });
  const post = (fn: (r: Request) => Promise<Response>, url: string, body: unknown) => fn(req(url, { method: "POST", token, origin: ORIGIN, body }));
  const digestOf = async (body: Record<string, unknown>) => {
    const r = await post(digestPOST, "/api/digest", body);
    return r.status === 200 ? (await r.json()).room : r.status;
  };

  it("digest: by Claude Code id, omp room id, or omp session file (a subagent's too); 422 for a shared folder or an unknown id", async () => {
    expect(await digestOf({ from_session: SID, from_cwd: path.join(shop, "clean") })).toBe(SID);
    expect(await digestOf({ from_room: CODING, from_cwd: shop })).toBe(CODING);
    expect(await digestOf({ from_session_file: path.join(path.dirname(codingDir), "mkt", "2026-11-08T00-00-00-000Z_01a1mkt.jsonl"), from_cwd: shop })).toBe(MKT);
    expect(await digestOf({ from_session_file: path.join(codingDir, "2026-11-08T00-00-00-000Z_01a1coding", "worker.jsonl"), from_cwd: shop }), "a subagent").toBe(CODING);
    expect(await digestOf({ from_cwd: shop }), "coding and mkt both work there").toBe(422);
    expect(await digestOf({ from_room: "omp-ffffffffffffffff", from_cwd: path.join(shop, "clean") }), "never the folder's room").toBe(422);
    expect(await digestOf({ from_session_file: path.join(os.tmpdir(), "elsewhere", "x.jsonl"), from_cwd: path.join(shop, "clean") }), "an omp session no room holds").toBe(422);
    expect(await digestOf({ from_session: SID, from_room: CODING }), "two ids, two rooms").toBe(422);
  });

  it("fact: the identified room's label; the folder name, never a guessed room, when HQ cannot tell", async () => {
    const pendingFrom = async (text: string, ids: Record<string, unknown>) => {
      const r = await post(factsPOST, "/api/facts", { text, from: path.basename(shop), from_cwd: shop, ...ids });
      expect(r.status).toBe(201);
      return (await r.json()).pending.from;
    };
    expect(await pendingFrom("Múi giờ GMT+7", { from_room: MKT })).toBe("mkt");
    expect(await pendingFrom("Chủ là Tú", { from_session_file: path.join(codingDir, "2026-11-08T00-00-00-000Z_01a1coding.jsonl") })).toBe("coding");
    expect(await pendingFrom("Deploy thứ Sáu", {})).toBe(path.basename(shop));
  });

  it("send: the context line names the identified room; none when the folder is shared", async () => {
    const sent = async (text: string, ids: Record<string, unknown>) => {
      expect((await post(messagesPOST, "/api/messages", { session: "hq-web", text, from: path.basename(shop), from_cwd: shop, ...ids })).status).toBe(201);
      return sendKeys.mock.calls.at(-1)![1];
    };
    expect(await sent("chạy test giúp", { from_room: CODING })).toContain("[từ phòng coding");
    expect(await sent("đăng bài lúc 9h", { from_room: MKT })).toContain("[từ phòng mkt");
    expect(await sent("ai đang rảnh?", {})).not.toContain("[từ phòng");
    expect(await sent("dọn xong rồi", { from_session: SID })).toContain("[từ phòng clean");
  });
});
