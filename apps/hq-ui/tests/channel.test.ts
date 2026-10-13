import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { GET as inboxGET } from "@/app/api/channel/inbox/route";
import { POST as heartbeatPOST } from "@/app/api/channel/heartbeat/route";
import { POST as replyPOST } from "@/app/api/channel/reply/route";
import { GET as messagesGET } from "@/app/api/messages/route";
import { getToken } from "@/lib/server/auth";
import { CHANNEL_FRESH_MS, channelConnected, deliverOwnerMessage, isFresh, recordBeat } from "@/lib/server/channel";
import { getDb } from "@/lib/server/db";
import { channelArgs, sendKeysPlan, tmuxStartArgs } from "@/lib/server/proc";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

describe("heartbeat → channel-connected flag", () => {
  it("needs the token; no Origin is fine for the local channel", async () => {
    expect((await heartbeatPOST(req("/api/channel/heartbeat", { method: "POST", body: { session: "hq-a" } }))).status).toBe(401);
    const ok = await heartbeatPOST(req("/api/channel/heartbeat", { method: "POST", token, body: { session: "hq-a" } }));
    expect(ok.status).toBe(200);
    expect(channelConnected(getDb(), "hq-a")).toBe(true);
    expect(channelConnected(getDb(), "hq-b")).toBe(false);
  });
  it("rejects a bad session name and a foreign Origin", async () => {
    expect((await heartbeatPOST(req("/api/channel/heartbeat", { method: "POST", token, body: { session: "a;b" } }))).status).toBe(422);
    const evil = req("/api/channel/heartbeat", { method: "POST", token, origin: "http://evil.test", body: { session: "hq-a" } });
    expect((await heartbeatPOST(evil)).status).toBe(403);
  });
  it("goes stale after ~45 s", () => {
    const now = 1_000_000;
    expect(isFresh(now - CHANNEL_FRESH_MS + 1, now)).toBe(true);
    expect(isFresh(now - CHANNEL_FRESH_MS, now)).toBe(false);
    expect(isFresh(null, now)).toBe(false);
    recordBeat(getDb(), "hq-old", Date.now() - 60_000);
    expect(channelConnected(getDb(), "hq-old")).toBe(false);
  });
});

describe("owner message delivery path", () => {
  it("fresh heartbeat → channel (no keystrokes)", async () => {
    const sendKeys = vi.fn(async () => ({ ok: true, stderr: "" }));
    recordBeat(getDb(), "hq-live");
    const r = await deliverOwnerMessage(getDb(), "hq-live", "hi", { sendKeys });
    expect(r.delivery).toBe("channel");
    expect(r.message.delivery).toBe("channel");
    expect(sendKeys).not.toHaveBeenCalled();
  });
  it("no heartbeat → tmux fallback, recorded as terminal", async () => {
    const sendKeys = vi.fn(async () => ({ ok: true, stderr: "" }));
    const r = await deliverOwnerMessage(getDb(), "hq-quiet", "hello", { sendKeys });
    expect(sendKeys).toHaveBeenCalledWith("hq-quiet", "hello");
    expect(r.delivery).toBe("terminal");
  });
  it("stale heartbeat → tmux fallback; tmux failure → failed with reason", async () => {
    recordBeat(getDb(), "hq-gone", Date.now() - 50_000);
    const sendKeys = vi.fn(async () => ({ ok: false, stderr: "can't find session: hq-gone" }));
    const r = await deliverOwnerMessage(getDb(), "hq-gone", "x", { sendKeys });
    expect(r.delivery).toBe("failed");
    expect(r.error).toContain("can't find session");
  });
  it("send-keys argv: literal text then Enter, exact target, no shell", () => {
    expect(sendKeysPlan("hq-a", "rm -rf / ; $(id)")).toEqual([
      ["send-keys", "-t", "=hq-a:", "-l", "--", "rm -rf / ; $(id)"],
      ["send-keys", "-t", "=hq-a:", "Enter"],
    ]);
    const multi = sendKeysPlan("hq-a", "line1\r\nline2");
    expect(multi[0]).toEqual(["set-buffer", "-b", "hq-msg-hq-a", "--", "line1\nline2"]);
    expect(multi[1]).toContain("-p");
    expect(multi.at(-1)).toEqual(["send-keys", "-t", "=hq-a:", "Enter"]);
    expect(() => sendKeysPlan("hq-a;x", "y")).toThrow();
  });
});

describe("channel flags", () => {
  it("default uses contract §3 flags when channel-mcp.json exists", () => {
    const home = process.env.HOME!;
    expect(channelArgs({}, "/nonexistent-home").mode).toBe("off");
    fs.mkdirSync(`${home}/.config/8sync/hq`, { recursive: true });
    fs.writeFileSync(`${home}/.config/8sync/hq/channel-mcp.json`, "{}");
    expect(channelArgs({}, home).args).toEqual([
      "--mcp-config", `${home}/.config/8sync/hq/channel-mcp.json`,
      "--dangerously-load-development-channels", "server:8sync-hq",
    ]);
  });
  it("HQ_CHANNEL_FLAGS=off and custom flags", () => {
    expect(channelArgs({ HQ_CHANNEL_FLAGS: "off" })).toMatchObject({ args: [], mode: "off" });
    expect(channelArgs({ HQ_CHANNEL_FLAGS: "--channels plugin:8sync-hq@8sync" }).args).toEqual(["--channels", "plugin:8sync-hq@8sync"]);
    expect(channelArgs({ HQ_CHANNEL_FLAGS: "--mcp-config ~/x.json" }, "/h").args).toEqual(["--mcp-config", "/h/x.json"]);
    expect(() => channelArgs({ HQ_CHANNEL_FLAGS: "--x $(id)" })).toThrow();
  });
  it("tmux start argv is env … claude with the channel env", () => {
    const a = tmuxStartArgs("hq-api", "/repo", {
      channel: { args: ["--mcp-config", "/c.json"], mode: "channel", reason: null },
      port: "8741",
    });
    expect(a).toEqual([
      "new-session", "-d", "-s", "hq-api", "-c", "/repo", "--",
      "env", "EIGHTSYNC_HQ_SESSION=hq-api", "MCP_PROTOCOL_NEGOTIATION=legacy", "HQ_UI_PORT=8741", "claude", "--mcp-config", "/c.json",
    ]);
    const off = tmuxStartArgs("hq-api", "/repo", { channel: { args: [], mode: "off", reason: null } });
    expect(off.slice(-3)).toEqual(["env", "EIGHTSYNC_HQ_SESSION=hq-api", "claude"]);
    expect(() => tmuxStartArgs("api; id", "/repo")).toThrow();
  });
});

describe("inbox long-poll + reply", () => {
  it("returns queued channel messages immediately, skips terminal ones", async () => {
    const db = getDb();
    recordBeat(db, "hq-ib");
    const sendKeys = async () => ({ ok: true, stderr: "" });
    const a = await deliverOwnerMessage(db, "hq-ib", "via channel", { sendKeys });
    db.prepare("DELETE FROM channel_beats WHERE session='hq-ib'").run();
    await deliverOwnerMessage(db, "hq-ib", "typed", { sendKeys });
    const res = await inboxGET(req("/api/channel/inbox?session=hq-ib&after=0", { token }));
    const body = await res.json();
    expect(body.messages.map((m: { text: string }) => m.text)).toEqual(["via channel"]);
    expect(body.last).toBe(a.message.id);
  });

  it("holds until a message arrives", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const db = getDb();
      const after = Number((db.prepare("SELECT max(id) m FROM messages").get() as { m: number }).m);
      const p = inboxGET(req(`/api/channel/inbox?session=hq-hold&after=${after}`, { token }));
      let done = false;
      void p.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(2000);
      expect(done).toBe(false);
      await deliverOwnerMessage(db, "hq-hold", "late", { sendKeys: async () => ({ ok: true, stderr: "" }) });
      await vi.advanceTimersByTimeAsync(600);
      const body = await (await p).json();
      expect(body.messages.map((m: { text: string }) => m.text)).toEqual(["late"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out empty after the hold", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    try {
      const p = inboxGET(req("/api/channel/inbox?session=hq-none&after=0", { token }));
      await vi.advanceTimersByTimeAsync(26_000);
      expect(await (await p).json()).toMatchObject({ messages: [], last: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects without token or with a bad session", async () => {
    expect((await inboxGET(req("/api/channel/inbox?session=hq-a"))).status).toBe(401);
    expect((await inboxGET(req("/api/channel/inbox?session=bad", { token }))).status).toBe(422);
  });

  it("reply is stored as session_reply and shows in /api/messages", async () => {
    const r = await replyPOST(req("/api/channel/reply", { method: "POST", token, body: { session: "hq-ib", text: "done" } }));
    expect(r.status).toBe(201);
    const list = await (await messagesGET(req("/api/messages?session=hq-ib", { token }))).json();
    expect(list.messages.at(-1)).toMatchObject({ kind: "session_reply", from_: "hq-ib", to_: "owner", text: "done" });
    expect(ORIGIN).toContain("127.0.0.1");
  });
});
