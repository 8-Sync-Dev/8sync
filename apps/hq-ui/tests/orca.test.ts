import { beforeAll, describe, expect, it, vi } from "vitest";

const ID = "3698e3a6-9b73-4b37-ab3a-368b169d0508";
const opened = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  mergedSessions: async () => [{ name: "dev", session_id: ID, cwd: "C:\\repo\\game\\.claude\\worktrees\\card-3", status: "running", tmux: null }],
}));
// The route must never start the real Orca from a test run.
vi.mock("@/lib/server/orca", async (orig) => {
  const real = await orig<typeof import("@/lib/server/orca")>();
  return {
    ...real,
    openInOrca: async (...a: unknown[]) => {
      opened.calls.push(a);
      return { ok: true, dir: a[0] };
    },
  };
});

import { GET, POST } from "@/app/api/sessions/[name]/orca/route";
import { getToken } from "@/lib/server/auth";
import { attachLine, orcaArgs, orcaBin, orcaSendArgs, orcaTitle, type Run } from "@/lib/server/orca";
import { ORIGIN, req, tempHome } from "./helpers";

// The real one (the module mock above only stands in for the route).
const { openInOrca } = await vi.importActual<typeof import("@/lib/server/orca")>("@/lib/server/orca");

const ctx = (name: string) => ({ params: Promise.resolve({ name }) }) as never;

describe("orcaBin", () => {
  const has = (...paths: string[]) => (p: string) => paths.includes(p);
  it("ORCA_CLI_COMMAND first, then the app's bundled CLI, then PATH", () => {
    expect(orcaBin({ ORCA_CLI_COMMAND: "/opt/orca/bin/orca" }, "linux", has("/opt/orca/bin/orca"))).toBe("/opt/orca/bin/orca");
    const bundled = "C:\\Users\\me\\AppData\\Local\\Programs\\orca\\resources\\bin\\orca.exe";
    expect(orcaBin({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32", has(bundled))).toBe(bundled);
    expect(orcaBin({ PATH: "C:\\x;C:\\tools" }, "win32", has("C:\\tools\\orca.exe"))).toBe("C:\\tools\\orca.exe");
    expect(orcaBin({}, "darwin", has("/Applications/Orca.app/Contents/Resources/bin/orca"))).toBe("/Applications/Orca.app/Contents/Resources/bin/orca");
    expect(orcaBin({}, "win32", has())).toBeNull();
  });
  it("Linux: only orca-ide, never a bare `orca` (the GNOME screen reader)", () => {
    expect(orcaBin({ PATH: "/usr/bin" }, "linux", has("/usr/bin/orca"))).toBeNull();
    expect(orcaBin({ PATH: "/usr/bin" }, "linux", has("/usr/bin/orca-ide"))).toBe("/usr/bin/orca-ide");
    // A relative ORCA_CLI_COMMAND is ignored: it would resolve against HQ's own folder.
    expect(orcaBin({ ORCA_CLI_COMMAND: "orca", PATH: "/usr/bin" }, "linux", has("orca", "/usr/bin/orca"))).toBeNull();
  });
});

describe("orca args and the copy line", () => {
  it("one argv per value: a plain shell tab in the worktree, then `claude attach <8 hex>` typed with Enter", () => {
    // No --command: Orca takes `claude …` for an agent launch and times out (seen live, Orca on Windows).
    expect(orcaArgs("C:\\repo\\game", "dev · card #3")).toEqual(["terminal", "create", "--worktree", "path:C:/repo/game", "--title", "dev  card 3", "--json"]);
    expect(orcaSendArgs("term_1", "3698e3a6")).toEqual(["terminal", "send", "--terminal", "term_1", "--text", "claude attach 3698e3a6", "--enter", "--json"]);
    expect(() => orcaSendArgs("term_1", "3698e3a6; rm -rf /")).toThrow();
    expect(orcaTitle("$(id)`")).toBe("id");
    expect(orcaTitle("***")).toBe("8sync");
  });
  it("copy line: cd into the room then attach; no cd when the folder has quoting characters", () => {
    expect(attachLine("C:\\repo\\game", ID)).toBe('cd "C:\\repo\\game"; claude attach 3698e3a6');
    expect(attachLine('/r/a"b', ID)).toBe("claude attach 3698e3a6");
    expect(attachLine("/r/$HOME", ID)).toBe("claude attach 3698e3a6");
    expect(attachLine(null, ID)).toBe("claude attach 3698e3a6");
  });
});

describe("openInOrca", () => {
  const answers = (...outs: string[]) => {
    const calls: string[][] = [];
    const run: Run = async (_bin, args) => {
      calls.push(args);
      return outs.shift() ?? "";
    };
    return { run, calls };
  };
  it("the room's worktree first; the repo root when Orca does not know the worktree", async () => {
    const miss = JSON.stringify({ ok: false, error: { code: "selector_not_found", message: "selector_not_found" } });
    const ok = JSON.stringify({ ok: true, result: { terminal: { handle: "term_ab-12" } } });
    const f = answers(miss, ok, JSON.stringify({ ok: true }), JSON.stringify({ ok: true }));
    const r = await openInOrca("C:\\repo\\game\\.claude\\worktrees\\card-3", "dev", "3698e3a6", "orca.exe", f.run);
    expect(r).toEqual({ ok: true, dir: "C:\\repo\\game" });
    expect(f.calls.map((a) => a.slice(0, 2).join(" "))).toEqual(["terminal create", "terminal create", "terminal send", "terminal switch"]);
    expect(f.calls.map((a) => a[3])).toEqual(["path:C:/repo/game/.claude/worktrees/card-3", "path:C:/repo/game", "term_ab-12", "term_ab-12"]);
    // Created without --focus (Orca times out with it on a worktree that is not open), then switched to.
    expect(f.calls.flat()).not.toContain("--focus");
  });
  it("any other failure stops at once: a second try could open a second tab", async () => {
    const f = answers(JSON.stringify({ ok: false, error: { code: "runtime_error", message: "Timed out waiting for terminal handle after creation" } }));
    expect(await openInOrca("/r/.claude/worktrees/w", "dev", "3698e3a6", "orca", f.run)).toEqual({ ok: false, error: "Timed out waiting for terminal handle after creation" });
    expect(f.calls).toHaveLength(1);
    // A handle that is not a plain token is never passed on.
    const g = answers(JSON.stringify({ ok: true, result: { terminal: { handle: "--x y" } } }));
    expect(await openInOrca("/r", "dev", "3698e3a6", "orca", g.run)).toEqual({ ok: false, error: "Orca mở tab nhưng không trả handle" });
    expect(g.calls).toHaveLength(1);
    // The tab opened but typing failed: say so, do not switch to a tab that is not attached.
    const h = answers(JSON.stringify({ ok: true, result: { terminal: { handle: "term_1" } } }), JSON.stringify({ ok: false, error: { message: "gone" } }));
    expect(await openInOrca("/r", "dev", "3698e3a6", "orca", h.run)).toEqual({ ok: false, error: "Đã mở tab trong Orca nhưng chưa gõ được lệnh: gone" });
    expect(h.calls).toHaveLength(2);
  });
  it("plain reasons: no Orca, repo not added, garbage output", async () => {
    expect(await openInOrca("/r", "dev", "3698e3a6", null)).toEqual({ ok: false, error: "Orca chưa cài trên máy này" });
    const miss = JSON.stringify({ ok: false, error: { code: "selector_not_found" } });
    expect(await openInOrca("/r", "dev", "3698e3a6", "orca", answers(miss).run)).toEqual({ ok: false, error: "Orca chưa có repo này (orca repo add <thư mục>)" });
    expect(await openInOrca("/r", "dev", "3698e3a6", "orca", answers("not json").run)).toEqual({ ok: false, error: "Orca không trả lời" });
  });
});

describe("/api/sessions/[name]/orca", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
  });
  it("401 without the token; 422 for a name that is not a session id", async () => {
    expect((await GET(req(`/api/sessions/${ID}/orca`), ctx(ID))).status).toBe(401);
    expect((await POST(req(`/api/sessions/${ID}/orca`, { method: "POST", origin: ORIGIN }), ctx(ID))).status).toBe(401);
    expect((await GET(req("/api/sessions/dev/orca", { token }), ctx("dev"))).status).toBe(422);
  });
  it("GET: whether Orca is here and the line to copy; POST opens the live room's folder, 404 for another id", async () => {
    const g = await GET(req(`/api/sessions/${ID}/orca`, { token }), ctx(ID));
    const info = (await g.json()) as { orca: boolean; command: string };
    expect(typeof info.orca).toBe("boolean");
    expect(info.command).toBe('cd "C:\\repo\\game\\.claude\\worktrees\\card-3"; claude attach 3698e3a6');
    const p = await POST(req(`/api/sessions/${ID}/orca`, { method: "POST", token, origin: ORIGIN, body: { title: "dev" } }), ctx(ID));
    expect(p.status).toBe(200);
    expect(opened.calls.at(-1)).toEqual(["C:\\repo\\game\\.claude\\worktrees\\card-3", "dev", "3698e3a6"]);
    const other = "11111111-2222-3333-4444-555555555555";
    expect((await POST(req(`/api/sessions/${other}/orca`, { method: "POST", token, origin: ORIGIN }), ctx(other))).status).toBe(404);
  });
});
