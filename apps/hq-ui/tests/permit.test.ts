import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { answerPermit, permitDir, readPermits } from "@/lib/server/permit";
import { ORIGIN, req, tempHome } from "./helpers";

const SID = "b1f0bf3e-7c16-4504-8552-f2dff0af64f9";
// The shape crates/cli/src/verbs/ccc/permit.rs `wait_for_owner` writes (seconds).
const ask = (dir: string, id: string, until: number, session = SID) =>
  fs.writeFileSync(path.join(dir, `${session}.ask.json`), JSON.stringify({ schema: 1, id, session, tool: "EnterWorktree", what: "card-7", at: until - 60, until, then: "allow", why: null }));

describe("permission requests", () => {
  it("lists open requests and drops ones past their deadline or malformed", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-permit-"));
    const now = 1_000_000_000_000;
    ask(dir, "a", now / 1000 + 30);
    ask(dir, "b", now / 1000 - 1, "11111111-2222-3333-4444-555555555555");
    fs.writeFileSync(path.join(dir, "junk.ask.json"), "{not json");
    fs.writeFileSync(path.join(dir, "evil.ask.json"), JSON.stringify({ id: "x", session: "../../etc", at: 1, until: now }));
    expect(readPermits(now, dir)).toMatchObject([{ session: SID, id: "a", tool: "EnterWorktree", what: "card-7", then: "allow", why: null }]);
    expect(readPermits(now, path.join(dir, "missing"))).toEqual([]);
  });

  it("writes the owner's click only for the request that is open now", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-permit-"));
    ask(dir, "live", Date.now() / 1000 + 60);
    expect(answerPermit(SID, "old", "allow", dir)).toMatchObject({ ok: false });
    expect(answerPermit("../x", "live", "allow", dir)).toMatchObject({ ok: false });
    expect(answerPermit(SID, "live", "allow", dir)).toEqual({ ok: true });
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${SID}.answer.json`), "utf8"))).toMatchObject({ id: "live", decision: "allow" });
  });
});

describe("POST /api/sessions/[name]/permit", () => {
  let token = "";
  beforeAll(async () => {
    tempHome();
    token = (await import("@/lib/server/auth")).getToken();
  });
  const post = async (name: string, body: unknown) => {
    const { POST } = await import("@/app/api/sessions/[name]/permit/route");
    return POST(req(`/api/sessions/${name}/permit`, { method: "POST", token, origin: ORIGIN, body }), { params: Promise.resolve({ name }) } as never);
  };

  it("answers the open request in the HQ home, and refuses bad input or a stale id", async () => {
    const dir = permitDir();
    fs.mkdirSync(dir, { recursive: true });
    ask(dir, "r1", Date.now() / 1000 + 60);
    expect((await post(SID, { id: "r1", decision: "maybe" })).status).toBe(422);
    expect((await post(SID, { id: "r0", decision: "allow" })).status).toBe(409);
    expect((await post(SID, { id: "r1", decision: "deny" })).status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(dir, `${SID}.answer.json`), "utf8")).decision).toBe("deny");
  });
});

describe("PermitCard markup", () => {
  it("shows what the room asks, both buttons and the countdown", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { AskPanel } = await import("@/components/hq/ask-panel");
    const now = 1_000_000_000_000;
    const permit = { session: SID, id: "r1", tool: "Bash", what: "Install deps · `pnpm install`", at: now / 1000, until: now / 1000 + 42, then: "allow" as const, why: null };
    const room = { key: SID, label: "dev", session_id: SID, project: "ai-game-studio", waiting: null, ask: null, permit, tmux: false };
    const html = renderToStaticMarkup(createElement(AskPanel, { rooms: [room], now, token: "t", onOpen: () => {} }));
    for (const s of ["Xin quyền chạy lệnh", "Install deps", "Cho phép", "Từ chối", "sau 42 s phòng tự cho phép và làm tiếp"]) expect(html).toContain(s);
  });

  it("says what silence does: proceed with everyday work, skip a ship step and say why", async () => {
    const { silence } = await import("@/components/hq/ask-panel");
    expect(silence({ then: "allow", why: null }, 30)).toContain("sau 30 s phòng tự cho phép");
    expect(silence({ then: "allow", why: null }, 0)).toBe("Hết giờ: phòng đã tự cho phép và làm tiếp.");
    const skip = silence({ then: "deny", why: "merge chờ Ship" }, 30);
    expect(skip).toContain("bỏ bước này (merge chờ Ship)");
    // a request from an older 8sync (no `then`) always skipped
    expect(silence({ then: null, why: null }, 5)).toContain("bỏ bước này,");
  });
});
