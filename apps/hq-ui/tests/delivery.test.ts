import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as inboxGET } from "@/app/api/channel/inbox/route";
import { POST as keysPOST } from "@/app/api/sessions/[name]/keys/route";
import { getToken } from "@/lib/server/auth";
import {
  CHANNEL_ACK_MS,
  deliverOwnerMessage,
  deliverWatched,
  getChannelState,
  notePane,
  recordBeat,
  retryIfUnanswered,
  SessionWaiting,
  setChannelState,
} from "@/lib/server/channel";
import { getDb } from "@/lib/server/db";
import { detectPane } from "@/lib/server/pane";
import { KEY_ALLOW, keysPlan } from "@/lib/server/proc";
import { insertMessage } from "@/lib/server/queries";
import { ORIGIN, req, tempHome } from "./helpers";

let token = "";
beforeAll(() => {
  tempHome();
  token = getToken();
});

const ok = async () => ({ ok: true, stderr: "" });
const BANNER =
  "\x1b[33m⚠ Channels are not enabled for your org · have an administrator set channelsEnabled\x1b[0m\n> \n";

describe("pane detection", () => {
  it("spots the org banner, with or without ANSI", () => {
    expect(detectPane(BANNER).blocked).toBe(true);
    expect(detectPane("policy: channelsEnabled=false").blocked).toBe(true);
    expect(detectPane("Listening for channel messages from server:8sync-hq").blocked).toBe(false);
  });
  it("org banner only counts near the bottom; assistant text mentioning channelsEnabled does not", () => {
    const filler = Array.from({ length: 14 }, (_, i) => `line ${i}`).join("\n");
    const chat = `● You can set channelsEnabled in managed settings.\n${filler}\n> `;
    expect(detectPane(chat).blocked).toBe(false);
    expect(detectPane(`${filler}\n${BANNER}`).blocked).toBe(true);
    // A fresh capture without the banner after a restart: not blocked (state itself is cleared on restart).
    expect(notePane(getDb(), "hq-fresh", "> ")).toBe(false);
  });
  it("a markdown quote '> 1. foo' is not a menu; a cursor glyph is", () => {
    expect(detectPane("Here is a list:\n> 1. foo\n> 2. bar\n> ").waiting).toBeNull();
    expect(detectPane("Pick\n› 1. foo\n  2. bar").waiting).toBe("Waiting for a choice");
  });
  it.each([
    ["Do you trust the files in this folder?\n❯ 1. Yes, I trust this folder\n  2. No, exit", "Trust this folder?"],
    ["Teach auto mode? \n  1. Yes  2. Not now  3. Never", "Auto mode question"],
    ["Bash command\n  rm -rf build\nDo you want to proceed?\n❯ 1. Yes\n  2. No", "Permission prompt"],
    ["WARNING: Loading development channels\n❯ 1. I am using this for local development\n  2. Exit", "Channel warning"],
    ["Pick one\n❯ 1. Alpha\n  2. Beta", "Waiting for a choice"],
  ])("dialog %#", (pane, label) => {
    expect(detectPane(pane).waiting).toBe(label);
  });
  it("ignores dialog text that has scrolled far up, and a bare status line", () => {
    const old = "Do you want to proceed?\n" + Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    expect(detectPane(old).waiting).toBeNull();
    expect(detectPane("--dangerously-load-development-channels server:8sync-hq\n> ").waiting).toBeNull();
  });
});

describe("blocked-by-org", () => {
  it("fresh heartbeat but org banner in the pane → terminal, and it sticks", async () => {
    const db = getDb();
    recordBeat(db, "hq-org");
    const sendKeys = vi.fn(ok);
    const r = await deliverOwnerMessage(db, "hq-org", "hello", { sendKeys, capture: async () => BANNER });
    expect(r.delivery).toBe("terminal");
    expect(sendKeys).toHaveBeenCalledWith("hq-org", "hello");
    expect(getChannelState(db, "hq-org")).toBe("blocked-by-org");
    // Banner scrolled away: still blocked, no new capture needed.
    const capture = vi.fn(async () => "> ");
    const r2 = await deliverOwnerMessage(db, "hq-org", "again", { sendKeys, capture });
    expect(r2.delivery).toBe("terminal");
    expect(capture).toHaveBeenCalledTimes(1); // always captured now: the dialog check runs before any typing
  });
  it("clean pane + fresh heartbeat → channel", async () => {
    const db = getDb();
    recordBeat(db, "hq-ok");
    const r = await deliverOwnerMessage(db, "hq-ok", "hi", { sendKeys: vi.fn(ok), capture: async () => "> " });
    expect(r.delivery).toBe("channel");
  });
  it("notePane records the state; 'unresponsive' never overwrites it", () => {
    const db = getDb();
    expect(notePane(db, "hq-np", "nothing")).toBe(false);
    expect(notePane(db, "hq-np", BANNER)).toBe(true);
    setChannelState(db, "hq-np", "unresponsive");
    expect(getChannelState(db, "hq-np")).toBe("blocked-by-org");
    setChannelState(db, "hq-np", null);
    expect(getChannelState(db, "hq-np")).toBeNull();
  });
});

describe("channel → terminal retry", () => {
  afterEach(() => vi.useRealTimers());

  it("silence for 25 s, never fetched → typed once, tagged channel→terminal, no sticky state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "Date"] });
    const db = getDb();
    recordBeat(db, "hq-quiet2");
    const sendKeys = vi.fn(ok);
    const r = await deliverWatched(db, "hq-quiet2", "status?", { sendKeys, capture: async () => "> " });
    expect(r.delivery).toBe("channel");
    await vi.advanceTimersByTimeAsync(CHANNEL_ACK_MS - 1000);
    expect(sendKeys).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(sendKeys).toHaveBeenCalledTimes(1);
    expect(sendKeys).toHaveBeenCalledWith("hq-quiet2", "status?");
    const row = db.prepare("SELECT delivery FROM messages WHERE id = ?").get(r.message.id);
    expect(row).toEqual({ delivery: "channel→terminal" });
    expect(getChannelState(db, "hq-quiet2")).toBeNull();
    // One timeout does not turn the channel off.
    const next = await deliverOwnerMessage(db, "hq-quiet2", "again", { sendKeys, capture: async () => "> " });
    expect(next.delivery).toBe("channel");
  });

  it("picked up by the inbox poller → never retyped, only marked unconfirmed", async () => {
    const db = getDb();
    recordBeat(db, "hq-seen");
    const sendKeys = vi.fn(ok);
    const r = await deliverOwnerMessage(db, "hq-seen", "did you get this", { sendKeys, capture: async () => "> " });
    const res = await inboxGET(req(`/api/channel/inbox?session=hq-seen&after=0`, { token }));
    const body = await res.json();
    expect(body.messages.map((m: { id: number }) => m.id)).toContain(r.message.id);
    expect(body.max).toBeGreaterThanOrEqual(r.message.id);
    expect(db.prepare("SELECT picked_up_at p FROM messages WHERE id = ?").get(r.message.id)).not.toEqual({ p: null });
    expect(await retryIfUnanswered(db, r.message.id, { sendKeys })).toBe("unconfirmed");
    expect(sendKeys).not.toHaveBeenCalled();
    expect(db.prepare("SELECT delivery FROM messages WHERE id = ?").get(r.message.id)).toEqual({ delivery: "unconfirmed" });
    expect(getChannelState(db, "hq-seen")).toBeNull();
  });

  it("a reply or any journal row from the session in time → no retry", async () => {
    const db = getDb();
    recordBeat(db, "hq-talk");
    const sendKeys = vi.fn(ok);
    const r = await deliverOwnerMessage(db, "hq-talk", "q", { sendKeys, capture: async () => "> " });
    insertMessage(db, { ts: Date.now(), session: "hq-talk", team: null, kind: "task_created", from_: null, to_: null, text: "t" });
    expect(await retryIfUnanswered(db, r.message.id, { sendKeys })).toBe("answered");
    expect(sendKeys).not.toHaveBeenCalled();
  });

  it("only channel rows are retried; a tmux failure is recorded as failed", async () => {
    const db = getDb();
    const t = await deliverOwnerMessage(db, "hq-none2", "typed", { sendKeys: ok });
    expect(await retryIfUnanswered(db, t.message.id, { sendKeys: vi.fn(ok) })).toBe("skipped");
    recordBeat(db, "hq-dead");
    const c = await deliverOwnerMessage(db, "hq-dead", "x", { sendKeys: ok, capture: async () => "> " });
    expect(await retryIfUnanswered(db, c.message.id, { sendKeys: async () => ({ ok: false, stderr: "gone" }) })).toBe("failed");
    expect(db.prepare("SELECT delivery FROM messages WHERE id = ?").get(c.message.id)).toEqual({ delivery: "failed" });
  });
});

describe("terminal keys", () => {
  it("maps allowlisted names to tmux keys, characters as literals", () => {
    const r = keysPlan("hq-a", { keys: ["Up", "Esc", "1", "y", "Enter"] });
    expect(r).toEqual({
      ok: true,
      steps: [
        ["send-keys", "-t", "=hq-a:", "Up"],
        ["send-keys", "-t", "=hq-a:", "Escape"],
        ["send-keys", "-t", "=hq-a:", "-l", "--", "1"],
        ["send-keys", "-t", "=hq-a:", "-l", "--", "y"],
        ["send-keys", "-t", "=hq-a:", "Enter"],
      ],
    });
    expect(Object.keys(KEY_ALLOW).sort()).toEqual(["1", "2", "3", "Down", "Enter", "Esc", "Tab", "Up", "n", "y"].sort());
  });
  it.each([
    [{ keys: ["C-c"] }],
    [{ keys: ["Escape"] }],
    [{ keys: ["toString"] }],
    [{ keys: ["__proto__"] }],
    [{ keys: [] }],
    [{ keys: Array(9).fill("Enter") }],
    [{ keys: "Enter" }],
    [{ keys: [1] }],
    [{ text: "" }],
    [{ text: "a\nb" }],
    [{ text: "\x03" }],
    [{ text: "\x1b[A" }],
    [{ text: "x", enter: "yes" }],
    [{}],
  ])("refuses %j", (body) => {
    expect(keysPlan("hq-a", body as Record<string, unknown>).ok).toBe(false);
  });
  it("types one literal line, Enter only when asked", () => {
    expect(keysPlan("hq-a", { text: "-t $(id); rm", enter: false })).toEqual({
      ok: true,
      steps: [["send-keys", "-t", "=hq-a:", "-l", "--", "-t $(id); rm"]],
    });
    const r = keysPlan("hq-a", { text: "yes", enter: true });
    expect(r.ok && r.steps.at(-1)).toEqual(["send-keys", "-t", "=hq-a:", "Enter"]);
    expect(keysPlan("hq-a;x", { keys: ["Enter"] }).ok).toBe(false);
  });
  it("route: token, Origin, session name and allowlist are enforced before tmux", async () => {
    const call = (name: string, body: unknown, o: { token?: string | null; origin?: string | null } = {}) =>
      keysPOST(
        req(`/api/sessions/${encodeURIComponent(name)}/keys`, {
          method: "POST",
          token: o.token === undefined ? token : o.token,
          origin: o.origin === undefined ? ORIGIN : o.origin,
          body,
        }),
        { params: Promise.resolve({ name }) },
      );
    expect((await call("hq-a", { keys: ["Enter"] }, { token: null })).status).toBe(401);
    expect((await call("hq-a", { keys: ["Enter"] }, { origin: null })).status).toBe(403);
    expect((await call("hq-a", { keys: ["Enter"] }, { origin: "http://evil.test" })).status).toBe(403);
    expect((await call("a;b", { keys: ["Enter"] })).status).toBe(422);
    expect((await call("hq-a", { keys: ["C-c"] })).status).toBe(422);
  });
});

const TEACH =
  "   Teach auto mode about your environment?\n   Claude Code reads this project, your recent Claude sessions, and\n     How you use Claude here     Mixed\n   ❯ Also scan shell history     true\n     Continue\n   ←/→ to change · Enter to continue · Esc to cancel";

describe("session waiting on a dialog: never type", () => {
  it("detects the real auto-mode wizard pane, and unknown dialogs by footer", () => {
    expect(detectPane(TEACH).waiting).toBe("Auto mode question");
    expect(detectPane("Some new wizard\n  Option A\n  Enter to confirm · Esc to cancel").waiting).toBe("Waiting for a choice");
    expect(detectPane("Pick\n  ←/→ to change").waiting).toBe("Waiting for a choice");
    expect(detectPane("> ").waiting).toBeNull();
  });

  it("deliverOwnerMessage throws SessionWaiting, types and stores nothing", async () => {
    const db = getDb();
    recordBeat(db, "hq-wait");
    const sendKeys = vi.fn(ok);
    await expect(deliverOwnerMessage(db, "hq-wait", "hi", { sendKeys, capture: async () => TEACH })).rejects.toBeInstanceOf(SessionWaiting);
    expect(sendKeys).not.toHaveBeenCalled();
    expect(db.prepare("SELECT count(*) c FROM messages WHERE session = 'hq-wait'").get()).toEqual({ c: 0 });
  });

  it("retry: dialog opened after a channel delivery → held, not typed", async () => {
    const db = getDb();
    recordBeat(db, "hq-wait2");
    const sendKeys = vi.fn(ok);
    const r = await deliverOwnerMessage(db, "hq-wait2", "hi", { sendKeys, capture: async () => "> " });
    expect(r.delivery).toBe("channel");
    expect(await retryIfUnanswered(db, r.message.id, { sendKeys, capture: async () => TEACH })).toBe("held");
    expect(sendKeys).not.toHaveBeenCalled();
    expect(db.prepare("SELECT delivery FROM messages WHERE id = ?").get(r.message.id)).toEqual({ delivery: "held" });
  });
});
