import { beforeAll, describe, expect, it, vi } from "vitest";

const sendKeys = vi.hoisted(() => vi.fn(async () => ({ ok: true, stderr: "" })));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  sendKeys,
  capturePlain: async () => "   Teach auto mode about your environment?\n   ❯ Also scan shell history     true\n   ←/→ to change · Enter to continue · Esc to cancel",
}));

import { POST as messagesPOST } from "@/app/api/messages/route";
import { POST as tasksPOST } from "@/app/api/tasks/route";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

describe("409 session-waiting", () => {
  it("POST /api/messages refuses, types nothing, stores nothing", async () => {
    const res = await messagesPOST(req("/api/messages", { method: "POST", token, origin: ORIGIN, body: { session: "hq-w", text: "hello" } }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session-waiting", dialog: "Auto mode question" });
    expect(sendKeys).not.toHaveBeenCalled();
    expect(getDb().prepare("SELECT count(*) c FROM messages WHERE session = 'hq-w'").get()).toEqual({ c: 0 });
  });
  it("POST /api/tasks refuses, types nothing, creates no task", async () => {
    const res = await tasksPOST(req("/api/tasks", { method: "POST", token, origin: ORIGIN, body: { session: "hq-w", subject: "do it" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("session-waiting");
    expect(sendKeys).not.toHaveBeenCalled();
    expect(getDb().prepare("SELECT count(*) c FROM tasks WHERE session = 'hq-w'").get()).toEqual({ c: 0 });
  });
});
