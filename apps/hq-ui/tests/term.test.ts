import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSse } from "@/components/hq/live-terminal";
import { IDLE_CLOSE_MS, SHELL_IDLE_MS, SHELL_KEY, clampSize, closeTerm, input, openShell, openTerm, poll, shellArgs, termArgs, termOpen, watch } from "@/lib/server/term";

const ID = "3698e3a6-9b73-4b37-ab3a-368b169d0508";

/** A fake `8sync ccc term` process: what HQ writes to stdin is collected, stdout is pushed by the test. */
function fakeSpawn() {
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];
  const written: string[] = [];
  let proc: EventEmitter & { stdout: PassThrough; stdin: PassThrough; kill: () => void };
  const spawn = (cmd: string, args: string[], opts: { cwd?: string }) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const stdin = new PassThrough();
    stdin.on("data", (b: Buffer) => written.push(b.toString()));
    proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin, kill: () => proc.emit("exit", 0) });
    return proc as never;
  };
  return { spawn, calls, written, proc: () => proc };
}

afterEach(() => {
  closeTerm(ID);
  closeTerm(SHELL_KEY);
  vi.useRealTimers();
});

describe("web terminal bridge", () => {
  it("runs `8sync ccc term <id>` in the room's folder, shares one bridge and replays the screen to a late viewer", async () => {
    const f = fakeSpawn();
    const t = openTerm(ID, "/repo/game", { cols: 100, rows: 30 }, f.spawn);
    expect(f.calls).toEqual([{ cmd: "8sync", args: termArgs(ID, 100, 30), cwd: "/repo/game" }]);
    expect(termArgs(ID, 100, 30)).toEqual(["ccc", "term", ID, "--cols", "100", "--rows", "30"]);
    expect(openTerm(ID, "/repo/game", { cols: 80, rows: 20 }, f.spawn)).toBe(t);
    expect(f.calls).toHaveLength(1);
    f.proc().stdout.write("hello ");
    await new Promise((r) => setImmediate(r));
    const seen: string[] = [];
    watch(ID, t, (b) => seen.push(b ? b.toString() : "<end>"));
    f.proc().stdout.write("world");
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual(["hello ", "world"]);
    f.proc().emit("exit", 0);
    expect(seen.at(-1)).toBe("<end>");
    expect(termOpen(ID)).toBe(false);
  });

  it("sends keys and sizes as JSON lines, refuses oversize input and a closed terminal", async () => {
    const f = fakeSpawn();
    openTerm(ID, null, { cols: 100, rows: 30 }, f.spawn);
    expect(input(ID, { data: "1\r" })).toBe(true);
    expect(input(ID, { cols: 9000, rows: 1 })).toBe(true);
    expect(input(ID, { data: "x".repeat(5000) })).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(f.written.join("")).toBe(`{"i":"1\\r"}\n{"r":[500,2]}\n`);
    expect(input("11111111-2222-3333-4444-555555555555", { data: "x" })).toBe(false);
  });

  it("closes 60 s after the last viewer leaves, not while someone watches", () => {
    vi.useFakeTimers();
    const f = fakeSpawn();
    const t = openTerm(ID, null, { cols: 100, rows: 30 }, f.spawn);
    const stop = watch(ID, t, () => {});
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(termOpen(ID)).toBe(true);
    stop();
    vi.advanceTimersByTime(IDLE_CLOSE_MS - 1);
    expect(termOpen(ID)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(termOpen(ID)).toBe(false);
  });

  it("never spawns for an id that is not a session uuid; sizes are clamped", () => {
    const f = fakeSpawn();
    expect(() => openTerm("../../x", null, { cols: 80, rows: 24 }, f.spawn)).toThrow();
    expect(f.calls).toHaveLength(0);
    expect(clampSize(1.5, "x")).toEqual({ cols: 120, rows: 34 });
    expect(clampSize(1, 999)).toEqual({ cols: 2, rows: 300 });
  });

  it("the remote link polls: bytes after its cursor, a full replay when the cursor is not this bridge's", async () => {
    const f = fakeSpawn();
    const t = openTerm(ID, null, { cols: 100, rows: 30 }, f.spawn);
    f.proc().stdout.write("screen ");
    await new Promise((r) => setImmediate(r));
    const first = poll(ID, t, 0, -1);
    expect([first.out.toString(), first.reset, first.ended]).toEqual(["screen ", true, false]);
    f.proc().stdout.write("1 2 3");
    await new Promise((r) => setImmediate(r));
    const next = poll(ID, t, first.gen, first.cursor);
    expect([next.out.toString(), next.reset, next.cursor]).toEqual(["1 2 3", false, 12]);
    expect(poll(ID, t, first.gen, next.cursor).out.length).toBe(0);
    // A cursor from another bridge (HQ restarted it) or past the end replays what is kept.
    expect(poll(ID, t, first.gen + 1, 3)).toMatchObject({ reset: true, cursor: 12 });
    expect(poll(ID, t, first.gen, 99).out.toString()).toBe("screen 1 2 3");
    f.proc().emit("exit", 0);
    expect(poll(ID, t, first.gen, 12).ended).toBe(true);
  });

  it("a polled terminal closes 60 s after the last poll", () => {
    vi.useFakeTimers();
    const f = fakeSpawn();
    const t = openTerm(ID, null, { cols: 100, rows: 30 }, f.spawn);
    poll(ID, t, 0, -1);
    vi.advanceTimersByTime(IDLE_CLOSE_MS - 1);
    poll(ID, t, t.gen, 0);
    vi.advanceTimersByTime(IDLE_CLOSE_MS - 1);
    expect(termOpen(ID)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(termOpen(ID)).toBe(false);
  });

  it("a replay is marked answered only once the bridge has had input, so a late viewer never re-answers ESC[6n", async () => {
    const f = fakeSpawn();
    const t = openTerm(ID, null, { cols: 100, rows: 30 }, f.spawn);
    f.proc().stdout.write("\x1b[6n");
    await new Promise((r) => setImmediate(r));
    const first: (boolean | undefined)[] = [];
    watch(ID, t, (_b, answered) => first.push(answered))();
    expect(first).toEqual([false]);
    expect(poll(ID, t, 0, -1).answered).toBe(false);
    input(ID, { data: "\x1b[1;1R" });
    const late: (boolean | undefined)[] = [];
    watch(ID, t, (_b, answered) => late.push(answered))();
    expect(late).toEqual([true]);
    expect(poll(ID, t, 0, -1).answered).toBe(true);
    expect(poll(ID, t, t.gen, t.total).answered).toBe(false);
  });

  it("the owner's shell is one `8sync ccc term --shell` in the asked folder that outlives a closed panel for 30 min", () => {
    vi.useFakeTimers();
    const f = fakeSpawn();
    const t = openShell("/repo/game", { cols: 90, rows: 25 }, f.spawn);
    expect(f.calls).toEqual([{ cmd: "8sync", args: shellArgs(90, 25), cwd: "/repo/game" }]);
    expect(shellArgs(90, 25)).toEqual(["ccc", "term", "--shell", "--cols", "90", "--rows", "25"]);
    expect(openShell("/elsewhere", { cols: 80, rows: 20 }, f.spawn)).toBe(t);
    expect(f.calls).toHaveLength(1);
    expect(input(SHELL_KEY, { data: "ls\r" })).toBe(true);
    watch(SHELL_KEY, t, () => {})();
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(termOpen(SHELL_KEY)).toBe(true);
    vi.advanceTimersByTime(SHELL_IDLE_MS);
    expect(termOpen(SHELL_KEY)).toBe(false);
  });

  it("the browser reads SSE blocks split across chunks", () => {
    const a = parseSse("event: out\ndata: aGk=\n\nevent: ping\nda");
    expect(a.events).toEqual([{ event: "out", data: "aGk=" }]);
    const b = parseSse(`${a.rest}ta: {}\n\n`);
    expect(b.events).toEqual([{ event: "ping", data: "{}" }]);
  });
});
