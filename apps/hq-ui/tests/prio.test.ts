import { beforeAll, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async () => ({ ok: true, stdout: '{"card":{"id":4,"prio":0}}', stderr: "" })));
/** The live room's repo: a real temp dir (set in beforeAll), so the test runs the same on every OS. */
const room = vi.hoisted(() => ({ cwd: "", alive: true }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  // `alive: false`: `claude agents` is down, so no session is known alive.
  mergedSessions: async () => (room.alive ? [{ name: "s1", cwd: room.cwd, status: "running" }] : []),
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as boardGET } from "@/app/api/board/route";
import { POST } from "@/app/api/board/prio/route";
import { POST as unblockPOST } from "@/app/api/board/unblock/route";
import { CardDetail, PrioChip } from "@/components/hq/card-sheet";
import type { Card } from "@/lib/lanes";
import { getToken } from "@/lib/server/auth";
import { parsePrioBody, prioArgs, rushLine } from "@/lib/server/board";
import { teamRootsPath } from "@/lib/server/paths";
import { ORIGIN, req, tempHome } from "./helpers";

const card = (over: Partial<Card>): Card => ({ id: 4, text: "x", lane: "ready", check: "true", label: null, claim: null, pr: null, sha: null, bounces: 0, note: null, added: 0, ...over });

describe("card priority", () => {
  it("maps to `auto prio <id> P<n>|none --json` and validates the body", () => {
    expect(prioArgs(4, 0)).toEqual(["ccc", "auto", "prio", "4", "P0", "--json"]);
    expect(prioArgs(4, null)).toEqual(["ccc", "auto", "prio", "4", "none", "--json"]);
    expect(parsePrioBody({ root: "/r", id: 4, prio: 1 })).toEqual({ ok: true, value: { root: "/r", id: 4, prio: 1 } });
    expect(parsePrioBody({ root: "/r", id: 4, prio: null })).toMatchObject({ ok: true });
    for (const bad of [null, { root: "/r", id: 4 }, { root: "/r", id: 4, prio: 4 }, { root: "/r", id: 4, prio: "P0" }, { root: "/r", id: 0, prio: 1 }, { root: "/r", id: 1.5, prio: 1 }, { root: "", id: 4, prio: 1 }])
      expect(parsePrioBody(bad as Record<string, unknown> | null).ok).toBe(false);
  });

  it("chip: P0 red and P1 amber with words, P3 quiet, P2 and unset show nothing", () => {
    const html = (prio: number | null) => renderToStaticMarkup(createElement(PrioChip, { prio }));
    expect(html(0)).toContain("P0 · gấp nhất");
    expect(html(0)).toContain("var(--destructive)");
    expect(html(1)).toContain("P1 · gấp");
    expect(html(1)).toContain("var(--st-needs)");
    expect(html(3)).toContain("P3");
    expect(html(2)).toBe("");
    expect(html(null)).toBe("");
  });

  it("sheet: a picker with the card's level pressed (unset reads as P2) and the command", () => {
    const html = renderToStaticMarkup(createElement(CardDetail, { c: card({ prio: 1 }), now: 0, next: false, onPrio: async () => {} }));
    expect(html).toContain('aria-label="Mức ưu tiên"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>P1</);
    expect(html).toContain("8sync ccc auto prio 4 P0");
    const unset = renderToStaticMarkup(createElement(CardDetail, { c: card({}), now: 0, next: false, onPrio: async () => {} }));
    expect(unset).toMatch(/aria-pressed="true"[^>]*>P2</);
    expect(unset).toContain("Chưa đặt, tính như P2.");
  });
});

describe("POST /api/board/prio", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-prio-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    room.cwd = path.resolve(dir);
  });
  const post = (body: unknown, auth = true) => POST(req("/api/board/prio", { method: "POST", token: auth ? token : null, origin: ORIGIN, body }));

  it("runs only on a board HQ shows, in that root; refuses bad input before running anything", async () => {
    expect((await post({ root: room.cwd, id: 4, prio: 0 }, false)).status).toBe(401);
    expect((await post({ root: room.cwd, id: 4, prio: 9 })).status).toBe(422);
    expect((await post({ root: path.join(os.tmpdir(), "not-a-project"), id: 4, prio: 0 })).status).toBe(409);
    expect(run).not.toHaveBeenCalled();
    const ok = await post({ root: room.cwd.toUpperCase(), id: 4, prio: 0 });
    expect(ok.status).toBe(200);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "prio", "4", "P0", "--json"], 8_000, room.cwd);
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: không có card mở #99" } as never);
    const gone = await post({ root: room.cwd, id: 99, prio: 1 });
    expect(gone.status).toBe(502);
    expect((await gone.json()).error).toBe("không có card mở #99");
  });

  it("⚡ Làm ngay answers with the rooms the CLI called (zus/ide #21 sat 3 h at P0 with nobody told)", async () => {
    const out = { card: { id: 21, prio: 0 }, rushed: true, lead: [{ name: "lead", now: true }], woke: [{ name: "dev", now: true }] };
    run.mockResolvedValueOnce({ ok: true, stdout: JSON.stringify(out), stderr: "" } as never);
    const res = await post({ root: room.cwd, id: 21, prio: 0 });
    expect(await res.json()).toEqual({ ok: true, error: null, woke: "Đã gọi dev nhận #21 ngay · đã báo lead" });
  });

  it("`claude agents` down: a team root still shows its board and takes ⚡; other folders stay refused", async () => {
    room.alive = false;
    try {
      const other = path.join(os.tmpdir(), "hq-prio-not-a-team");
      expect((await post({ root: room.cwd, id: 4, prio: 0 })).status).toBe(409);
      fs.mkdirSync(path.dirname(teamRootsPath()), { recursive: true });
      // Rust writes the canonical spelling (`\\?\` on Windows).
      fs.writeFileSync(teamRootsPath(), JSON.stringify([process.platform === "win32" ? `\\\\?\\${room.cwd}` : room.cwd]));
      const ok = await post({ root: room.cwd, id: 4, prio: 0 });
      expect(ok.status).toBe(200);
      expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "prio", "4", "P0", "--json"], 8_000, room.cwd);
      expect((await unblockPOST(req("/api/board/unblock", { method: "POST", token, origin: ORIGIN, body: { root: room.cwd, id: 4 } }))).status).toBe(200);
      expect((await post({ root: other, id: 4, prio: 0 })).status).toBe(409);
      const boards = (await (await boardGET(req("/api/board", { token }))).json()).boards as { root: string }[];
      expect(boards.map((b) => path.resolve(b.root))).toEqual([room.cwd]);
    } finally {
      room.alive = true;
      fs.rmSync(teamRootsPath(), { force: true });
    }
  });
});

describe("rushLine", () => {
  it("names who was called; a holder, nobody free, no lead, no team or an older 8sync say so or stay silent", () => {
    const line = (v: unknown) => rushLine(JSON.stringify(v), 21);
    expect(line({ rushed: true, lead: [{ name: "lead" }], woke: [{ name: "dev" }, { name: "ui" }] })).toBe("Đã gọi dev, ui nhận #21 ngay · đã báo lead");
    expect(line({ rushed: true, lead: [], woke: [{ name: "dev" }] })).toBe("Đã gọi dev nhận #21 ngay");
    expect(line({ rushed: true, lead: [], lead_recent: true, woke: [{ name: "dev" }] })).toBe("Đã gọi dev nhận #21 ngay · lead đã được báo");
    expect(line({ rushed: true, lead: [{ name: "lead" }], woke: [], held: "dev2" })).toBe("dev2 đang giữ #21 · đã báo lead");
    expect(line({ rushed: true, lead: [{ name: "lead" }], woke: [] })).toBe("Chưa phòng nào rảnh nhận #21 · đã báo lead");
    expect(line({ rushed: false, lead: [], woke: [] })).toBeNull();
    expect(line({ card: { id: 21 } })).toBeNull();
    expect(rushLine("not json", 21)).toBeNull();
  });
});
