import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempHome } from "./helpers";

// The extension's polling as omp runs it, with `8sync` faked: per call the answer is its stdout, null
// (it failed or timed out), or "hang" (it never returns; `hung` holds what would finish it).
const sh = vi.hoisted(() => ({
  calls: [] as string[][],
  answer: (_args: string[]): string | null => null,
  hung: [] as ((stdout: string) => void)[],
}));
vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string) => void) => {
    sh.calls.push(args);
    const out = sh.answer(args);
    if (out === "hang") sh.hung.push((stdout) => cb(null, stdout));
    else void Promise.resolve().then(() => (out === null ? cb(new Error("8sync failed"), "") : cb(null, out)));
  },
}));

const home = tempHome(); // the extension writes HQ's state files under it, never the real ones
// Loaded at run time, as in room-model.test.ts: hq-ui's `tsc` must not follow it into omp's SDK types.
const EXT: string = new URL("../../../assets/extensions/8sync-inbox.ts", import.meta.url).href;
type Handler = (event: unknown, ctx: unknown) => unknown;
const ext = (await import(EXT)) as {
  default: (pi: unknown) => void;
  MODEL_CONTROL: string;
  pollGate: (st: { busy: number; gen: number; tick: number }, every: number, now: number) => boolean;
  within: (p: Promise<unknown>, ms: number) => Promise<boolean>;
};

const ROOM = "omp-ec49e72dc8e46307";
const OTHER = "omp-58c205d74a964fbb";
const CORE = path.join(home, "sessions", "C--Users-Admin", "core");
const PROFILE = path.join(home, "sessions", "C--Users-Admin", "profile");
const LS = JSON.stringify([
  { name: "profile", inbox_id: OTHER, session_dir: PROFILE },
  { name: "core", inbox_id: ROOM, session_dir: CORE },
]);
const claim = (id: string) => ["ccc", "inbox", "--session", id, "--json"];
const ack = (id: string) => ["ccc", "inbox", "--session", id, "--ack", "--json"];
const lsCall = [".", "ls", "--json"];

/** One omp process with the extension loaded: `start` is session_start, `tick` one 5 s tick. */
function omp(env: string | undefined, setModel: () => Promise<boolean> = async () => true) {
  if (env === undefined) delete process.env.EIGHTSYNC_ROOM_ID;
  else process.env.EIGHTSYNC_ROOM_ID = env;
  const on: Record<string, Handler> = {};
  const sent: string[] = [];
  let interval: (() => Promise<void>) | null = null;
  const ctx = (dir: string) => ({
    cwd: home,
    hasUI: false,
    model: { provider: "zai", id: "glm-5.3" },
    sessionManager: { getSessionDir: () => dir },
    modelRegistry: { find: (provider: string, id: string) => ({ provider, id }) },
    setInterval: (fn: () => Promise<void>) => {
      if (interval) throw new Error("a second interval");
      interval = fn;
    },
  });
  ext.default({
    on: (event: string, h: Handler) => (on[event] = h),
    getCommands: () => [],
    getThinkingLevel: () => "high",
    setThinkingLevel: () => {},
    setModel,
    sendUserMessage: (text: string) => sent.push(text),
  });
  return {
    sent,
    start: (dir: string) => on.session_start({ type: "session_start" }, ctx(dir)),
    resume: (dir: string) => on.session_switch({ type: "session_switch", reason: "resume" }, ctx(dir)),
    tick: () => {
      if (!interval) throw new Error("not polling");
      return interval();
    },
  };
}

const message = (text: string) => JSON.stringify({ text, messages: [text] });
let inbox: string[] = [];
const answers = (ls: () => string | null) => (args: string[]) => {
  if (args[0] === ".") return ls();
  if (args.includes("--ack") || args.includes("--release")) return "{}";
  return inbox.shift() ?? '{"text":null}';
};

beforeEach(() => {
  sh.calls.length = 0;
  sh.hung.length = 0;
  inbox = [];
});
afterEach(() => vi.useRealTimers());

describe("an omp room keeps polling HQ's inbox", () => {
  it("Orca's omp --resume: `8sync . ls` not answering at start is asked again, then the room polls", async () => {
    let up = false;
    sh.answer = answers(() => (up ? LS : null));
    const r = omp(undefined);
    await r.start(CORE);
    await r.tick();
    expect(sh.calls).toEqual([lsCall]);
    up = true;
    await r.tick();
    inbox.push(message("nhắn từ HQ"));
    await r.tick();
    expect(r.sent).toEqual(["nhắn từ HQ"]);
    expect(sh.calls.slice(1)).toEqual([lsCall, claim(ROOM), ack(ROOM)]);
  });

  it("a session that is no room is looked up once, then left alone", async () => {
    sh.answer = answers(() => "[]");
    const r = omp(undefined);
    await r.start(path.join(home, "elsewhere"));
    for (let i = 0; i < 5; i++) await r.tick();
    expect(sh.calls).toEqual([lsCall]);
  });

  it("a poll that never returns is given up after a minute; what it returns later is dropped", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    sh.answer = (args) => (sh.calls.length === 1 ? "hang" : answers(() => LS)(args));
    const r = omp(ROOM);
    await r.start(CORE);
    const stuck = r.tick();
    vi.setSystemTime(Date.now() + 30_000);
    await r.tick();
    expect(sh.calls).toEqual([claim(ROOM)]);
    vi.setSystemTime(Date.now() + 30_000);
    inbox.push(message("lần hai"));
    await r.tick();
    expect(r.sent).toEqual(["lần hai"]);
    sh.hung[0](message("trễ"));
    await stuck;
    expect(r.sent).toEqual(["lần hai"]);
    expect(sh.calls).toEqual([claim(ROOM), claim(ROOM), ack(ROOM)]);
  });

  it("a model switch that never settles is reported; the message sent with it still arrives and is acked", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    sh.answer = answers(() => LS);
    const r = omp(ROOM, () => new Promise<boolean>(() => {}));
    await r.start(CORE);
    const sw = `${ext.MODEL_CONTROL} ${JSON.stringify({ model: "zai/glm-5.4" })}`;
    inbox.push(JSON.stringify({ text: "framed", messages: [sw, "làm tiếp"] }));
    const poll = r.tick();
    await vi.advanceTimersByTimeAsync(20_000);
    await poll;
    expect(r.sent).toEqual(["làm tiếp"]);
    expect(sh.calls).toEqual([claim(ROOM), ack(ROOM)]);
    const state = JSON.parse(fs.readFileSync(path.join(home, ".local", "state", "8sync", "hq", "omp-model", `${ROOM}.json`), "utf8"));
    expect(state.error).toMatch(/chưa xong/);
    inbox.push(message("sau đó"));
    await r.tick();
    expect(r.sent).toEqual(["làm tiếp", "sau đó"]);
  });

  it("/resume of another room's session polls that room; the same dir keeps the id", async () => {
    sh.answer = answers(() => LS);
    const r = omp(ROOM);
    await r.start(CORE);
    await r.tick();
    r.resume(CORE + path.sep);
    await r.tick();
    expect(sh.calls).toEqual([claim(ROOM), claim(ROOM)]);
    r.resume(PROFILE);
    await r.tick();
    await r.tick();
    expect(sh.calls.slice(2)).toEqual([lsCall, claim(OTHER)]);
  });
});

describe("pollGate", () => {
  it("holds back while a poll runs, gives it up after a minute", () => {
    const st = { busy: 1_000, gen: 0, tick: 1 };
    expect(ext.pollGate(st, 1, 60_999)).toBe(false);
    expect(st).toEqual({ busy: 1_000, gen: 0, tick: 1 });
    expect(ext.pollGate(st, 1, 61_000)).toBe(true);
    expect(st).toEqual({ busy: 0, gen: 1, tick: 1 });
    expect(ext.pollGate({ busy: 0, gen: 0, tick: 4 }, 3, 0)).toBe(false);
  });
});
