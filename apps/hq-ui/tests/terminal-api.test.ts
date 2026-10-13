import { beforeAll, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  captureTmux: capture,
}));

import { GET } from "@/app/api/sessions/[name]/screen/route";
import { getToken } from "@/lib/server/auth";
import { req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

const call = (name: string, t: string | null) =>
  GET(req(`/api/sessions/${name}/screen`, { token: t }), { params: Promise.resolve({ name }) } as never);

describe("GET /api/sessions/:name/screen", () => {
  it("returns the ANSI pane text for an hq session", async () => {
    capture.mockResolvedValueOnce({ ok: true, stdout: "\u001b[32mhello\u001b[0m\n", stderr: "" });
    const res = await call("hq-a", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ name: "hq-a", text: "\u001b[32mhello\u001b[0m\n" });
    expect(typeof body.at).toBe("number");
  });

  it("404 when tmux has no such session", async () => {
    capture.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "can't find session: hq-zzz" });
    expect((await call("hq-zzz", token)).status).toBe(404);
  });

  it("422 for a name that is not an hq-* session, without touching tmux", async () => {
    capture.mockClear();
    expect((await call("bash", token)).status).toBe(422);
    expect(capture).not.toHaveBeenCalled();
  });

  it("401 without a token", async () => {
    capture.mockClear();
    expect((await call("hq-a", null)).status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });
});
