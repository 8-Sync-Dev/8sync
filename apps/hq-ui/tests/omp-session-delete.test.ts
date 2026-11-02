import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ORIGIN, req, tempHome } from "./helpers";

const ID = "omp-0123456789abcdef";
const m = vi.hoisted(() => ({
  calls: [] as { args: string[]; cwd?: string }[],
  result: { ok: true, stdout: "", stderr: "" } as { ok: boolean; stdout: string; stderr: string },
}));

vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run: async (_cmd: string, args: string[], _ms: number, cwd?: string) => {
    m.calls.push({ args, cwd });
    return m.result;
  },
}));
vi.mock("@/lib/server/floor", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/floor")>()),
  ompRoom: async (_db: unknown, id: string) => (id === ID ? { cwd: "C:/repo" } : null),
}));
vi.mock("@/lib/server/omp-sessions", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/omp-sessions")>()),
  listOmpSessions: async () => [{ name: "feat-x", inbox_id: ID }],
}));

import { DELETE } from "@/app/api/omp/sessions/route";
import { getToken } from "@/lib/server/auth";

const del = (id: string | null, token: string | null = getToken()) =>
  DELETE(req(`/api/omp/sessions${id ? `?id=${id}` : ""}`, { method: "DELETE", token, origin: ORIGIN }));

describe("DELETE /api/omp/sessions: Xóa phiên", () => {
  beforeAll(() => tempHome());
  beforeEach(() => {
    m.calls = [];
    m.result = { ok: true, stdout: "", stderr: "" };
  });

  it("runs `8sync . rm <its registry name> --purge` in the session's repo", async () => {
    const res = await del(ID);
    expect(res.status).toBe(200);
    expect(m.calls).toEqual([{ args: [".", "rm", "feat-x", "--purge"], cwd: "C:/repo" }]);
  });

  it("answers 409 with the CLI's reason when rm refuses", async () => {
    m.result = { ok: false, stdout: "", stderr: "Error: phiên 'feat-x' đang mở ở terminal khác (omp pid 42) — đóng nó trước rồi xoá\n" };
    const res = await del(ID);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).toContain("đang mở ở terminal khác (omp pid 42)");
  });

  it("runs nothing for an unknown or malformed id, or without the token", async () => {
    expect((await del("omp-ffffffffffffffff")).status).toBe(404);
    expect((await del("../x")).status).toBe(422);
    expect((await del(ID, null)).status).toBe(401);
    expect(m.calls).toEqual([]);
  });
});
