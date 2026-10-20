import { beforeAll, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async () => ({ ok: true, stdout: "", stderr: "" })));
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
import { POST } from "@/app/api/board/unblock/route";
import { CardDetail, forceKind } from "@/components/hq/card-sheet";
import { CardItem } from "@/components/hq/lanes-view";
import { UnblockAll, UnstickButton } from "@/components/hq/overview-view";
import { forceCall } from "@/components/hq/use-board";
import type { Card } from "@/lib/lanes";
import { getToken } from "@/lib/server/auth";
import { UNBLOCK_NOTE, unblockArgs } from "@/lib/server/board";
import { ORIGIN, req, tempHome } from "./helpers";

const card = (over: Partial<Card>): Card => ({ id: 46, text: "Chọn engine vật lý", lane: "ready", check: "true", label: null, claim: null, pr: null, sha: null, bounces: 0, note: null, added: 0, ...over });
const noop = async () => {};

describe("force buttons on a card", () => {
  it("Blocked: Gỡ block ngay; Backlog/Ready not P0: Làm ngay; anything else: none", () => {
    expect(forceKind(card({ lane: "blocked" }))).toBe("unblock");
    expect(forceKind(card({ lane: "blocked", prio: 0 }))).toBe("unblock");
    expect(forceKind(card({ lane: "backlog" }))).toBe("rush");
    expect(forceKind(card({ lane: "ready", prio: 1 }))).toBe("rush");
    expect(forceKind(card({ lane: "ready", prio: 0 }))).toBeNull();
    for (const lane of ["building", "qa", "review", "approved"] as const) expect(forceKind(card({ lane }))).toBeNull();
  });

  it("Làm ngay calls /api/board/prio with prio 0; Gỡ block ngay calls /api/board/unblock", async () => {
    const api = vi.fn(async () => ({}));
    await forceCall(api as never, "C:/w/game", { id: 7, lane: "backlog" });
    await forceCall(api as never, "C:/w/game", { id: 9, lane: "blocked" });
    expect(api.mock.calls).toEqual([
      ["/api/board/prio", { method: "POST", body: { root: "C:/w/game", id: 7, prio: 0 } }],
      ["/api/board/unblock", { method: "POST", body: { root: "C:/w/game", id: 9 } }],
    ]);
  });

  it("the card item and the card detail render the button beside (never inside) the card button", () => {
    const item = (c: Card) => renderToStaticMarkup(createElement(CardItem, { c, now: 0, next: false, onOpen: () => {}, onForce: noop }));
    const ready = item(card({ lane: "ready" }));
    expect(ready).toContain("Làm ngay");
    expect(ready).toContain('aria-label="Làm ngay card #46"');
    // a sibling of the card's own button: the card button closes before the force button opens
    expect(ready).toMatch(/<\/button><button[^>]*aria-label="Làm ngay card #46"/);
    expect(item(card({ lane: "blocked" }))).toContain("Gỡ block ngay");
    expect(item(card({ lane: "ready", prio: 0 }))).not.toContain("Làm ngay");
    expect(item(card({ lane: "building" }))).not.toContain("ngay");
    expect(renderToStaticMarkup(createElement(CardItem, { c: card({}), now: 0, next: false, onOpen: () => {} }))).not.toContain("Làm ngay");

    const detail = (c: Card) => renderToStaticMarkup(createElement(CardDetail, { c, now: 0, next: false, onPrio: noop, onForce: noop }));
    expect(detail(card({ lane: "backlog" }))).toContain("Làm ngay");
    expect(detail(card({ lane: "blocked" }))).toContain("Gỡ block ngay");
    expect(detail(card({ lane: "qa" }))).not.toContain("ngay card");
  });

  it("Tổng quan: “N card blocked · Gỡ hết ngay” only when Blocked has cards; “Gỡ kẹt ngay” with its count", () => {
    const all = renderToStaticMarkup(createElement(UnblockAll, { cards: [card({ id: 1, lane: "blocked" }), card({ id: 2, lane: "blocked" })], onUnblock: noop }));
    expect(all).toContain("2 card blocked");
    expect(all).toContain("Gỡ hết ngay");
    expect(renderToStaticMarkup(createElement(UnblockAll, { cards: [], onUnblock: noop }))).toBe("");
    const unstick = renderToStaticMarkup(createElement(UnstickButton, { token: "t", stuck: 3 }));
    expect(unstick).toContain("Gỡ kẹt ngay");
    expect(unstick).toContain(">3<");
  });
});

describe("POST /api/board/unblock", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-unblock-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    room.cwd = path.resolve(dir);
  });
  const post = (body: unknown, o: { auth?: boolean; origin?: string | null } = {}) =>
    POST(req("/api/board/unblock", { method: "POST", token: o.auth === false ? null : token, origin: o.origin === undefined ? ORIGIN : o.origin, body }));

  it("argv: move to Backlog with the owner's note, fixed words only", () => {
    expect(unblockArgs(46)).toEqual(["ccc", "auto", "move", "46", "backlog", "--note", UNBLOCK_NOTE]);
    expect(UNBLOCK_NOTE).toBe("owner: gỡ block ngay — lead quyết + viết AC + check, đưa ready lượt này");
  });

  it("refuses no token, a foreign Origin, a bad id or an unknown root before running anything", async () => {
    run.mockClear();
    expect((await post({ root: room.cwd, id: 46 }, { auth: false })).status).toBe(401);
    expect((await post({ root: room.cwd, id: 46 }, { origin: "http://evil.test" })).status).toBe(403);
    for (const id of [0, -1, 1.5, "46", "46; rm -rf /", null]) expect((await post({ root: room.cwd, id })).status).toBe(422);
    expect((await post({ root: path.join(os.tmpdir(), "not-a-project"), id: 46 })).status).toBe(409);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs move then prio P0 in the project root; a failed move stops before prio", async () => {
    run.mockClear();
    const ok = await post({ root: room.cwd.toUpperCase(), id: 46 });
    expect(ok.status).toBe(200);
    expect(run.mock.calls).toEqual([
      ["8sync", ["ccc", "auto", "move", "46", "backlog", "--note", UNBLOCK_NOTE], 8_000, room.cwd],
      ["8sync", ["ccc", "auto", "prio", "46", "P0", "--json"], 8_000, room.cwd],
    ]);
    run.mockClear();
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: không có card mở #99" } as never);
    const gone = await post({ root: room.cwd, id: 99 });
    expect(gone.status).toBe(502);
    expect((await gone.json()).error).toBe("không có card mở #99");
    expect(run).toHaveBeenCalledTimes(1);
  });
});
