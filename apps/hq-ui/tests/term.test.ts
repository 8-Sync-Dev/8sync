import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSse } from "@/components/hq/live-terminal";
import { HOST_GONE_EXIT, IDLE_CLOSE_MS, SHELL_IDLE_MS, clampSize, closeTerm, endedTerm, input, openShell, openTerm, poll, shellArgs, shellKey, shellsOpen, termArgs, termOpen, waitOutput, watch } from "@/lib/server/term";
import { termResponse } from "@/lib/server/term-http";

const ID = "3698e3a6-9b73-4b37-ab3a-368b169d0508";
const OMP = "omp-00000000000000b2";

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
  closeTerm(OMP);
  closeTerm(shellKey("/repo/game"));
  closeTerm(shellKey("/elsewhere"));
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

  it("the owner's shell is one `8sync ccc term --shell` per folder that outlives a closed panel for 30 min", () => {
    vi.useFakeTimers();
    const f = fakeSpawn();
    const t = openShell("/repo/game", { cols: 90, rows: 25 }, f.spawn);
    expect(f.calls).toEqual([{ cmd: "8sync", args: shellArgs(90, 25), cwd: "/repo/game" }]);
    expect(shellArgs(90, 25)).toEqual(["ccc", "term", "--shell", "--cols", "90", "--rows", "25"]);
    expect(openShell("/repo/game", { cols: 80, rows: 20 }, f.spawn)).toBe(t);
    expect(f.calls).toHaveLength(1);
    const other = openShell("/elsewhere", { cols: 80, rows: 20 }, f.spawn);
    expect(other).not.toBe(t);
    expect(f.calls[1]).toEqual({ cmd: "8sync", args: shellArgs(80, 20), cwd: "/elsewhere" });
    closeTerm(shellKey("/elsewhere"));
    expect(input(shellKey("/repo/game"), { data: "ls\r" })).toBe(true);
    watch(shellKey("/repo/game"), t, () => {})();
    vi.advanceTimersByTime(IDLE_CLOSE_MS * 2);
    expect(shellsOpen()).toBe(true);
    vi.advanceTimersByTime(SHELL_IDLE_MS);
    expect(shellsOpen()).toBe(false);
  });

  it("the browser reads SSE blocks split across chunks", () => {
    const a = parseSse("event: out\ndata: aGk=\n\nevent: ping\nda");
    expect(a.events).toEqual([{ event: "out", data: "aGk=" }]);
    const b = parseSse(`${a.rest}ta: {}\n\n`);
    expect(b.events).toEqual([{ event: "ping", data: "{}" }]);
  });
});

describe("dead room (attach found no job)", () => {
  it("flags the bridge dead when `claude attach` prints 'No job matching', and reports it in the poll", async () => {
    const f = fakeSpawn();
    const t = openTerm(ID, "/repo/x", { cols: 80, rows: 20 }, f.spawn);
    f.proc().stdout.write("No job matching '1eb79553'. Run 'claude agents' to list running sessions.\r\n");
    await new Promise((r) => setImmediate(r));
    expect(t.dead).toBe(true);
    expect(poll(ID, t, t.gen, -1).dead).toBe(true);
    f.proc().kill();
  });
  it("the owner's shell never turns dead on the same words", async () => {
    const f = fakeSpawn();
    const t = openShell("/repo/game", { cols: 80, rows: 20 }, f.spawn);
    f.proc().stdout.write("No job matching 'x'");
    await new Promise((r) => setImmediate(r));
    expect(t.dead).toBe(false);
  });
});

describe("omp ended on the PC (owner 2026-11-03: crashed there, the link never knew)", () => {
  it("a poll still on the ended bridge hears omp exited; only a fresh poll may open a new bridge", async () => {
    const f = fakeSpawn();
    const t = openTerm(OMP, "/repo/x", { cols: 80, rows: 20 }, f.spawn);
    f.proc().stdout.write("omp ready");
    await new Promise((r) => setImmediate(r));
    const p = poll(OMP, t, 0, -1);
    f.proc().emit("exit", HOST_GONE_EXIT);
    expect(termOpen(OMP)).toBe(false);
    const gone = endedTerm(OMP, p.gen);
    expect(gone).toBe(t);
    const res = await termResponse(new Request(`http://127.0.0.1/t?gen=${p.gen}&since=${p.cursor}&wait=20000`), OMP, gone!);
    expect(await res.json()).toMatchObject({ ended: true, exited: true, out: "" });
    expect(endedTerm(OMP, 0)).toBeUndefined();
  });
  it("a bridge HQ closed itself (a pane closed on the PC) is no news: the link's next poll gets a fresh bridge", () => {
    const f = fakeSpawn();
    const t = openTerm(OMP, null, { cols: 80, rows: 20 }, f.spawn);
    const p = poll(OMP, t, 0, -1);
    closeTerm(OMP);
    f.proc().emit("exit", HOST_GONE_EXIT);
    expect(endedTerm(OMP, p.gen)).toBeUndefined();
    const fresh = openTerm(OMP, null, { cols: 80, rows: 20 }, f.spawn);
    expect(fresh).not.toBe(t);
    expect(poll(OMP, fresh, p.gen, p.cursor)).toMatchObject({ reset: true, ended: false });
  });
  it("a link poll held on a bridge HQ closes meanwhile hears nothing, not that the room ended", async () => {
    const f = fakeSpawn();
    const t = openTerm(OMP, null, { cols: 80, rows: 20 }, f.spawn);
    const p = poll(OMP, t, 0, -1);
    const held = termResponse(new Request(`http://127.0.0.1/t?gen=${p.gen}&since=${p.cursor}&wait=20000`), OMP, t);
    closeTerm(OMP);
    f.proc().emit("exit", 0);
    expect(await (await held).json()).toMatchObject({ ended: false, exited: false, out: "", gen: p.gen, cursor: p.cursor });
  });
  it("a bridge HQ closed itself, or a Claude room's, is not reported as omp exiting", () => {
    const f = fakeSpawn();
    const t = openTerm(OMP, null, { cols: 80, rows: 20 }, f.spawn);
    f.proc().emit("exit", 0);
    expect(t.exited).toBe(false);
    const g = fakeSpawn();
    const c = openTerm(ID, null, { cols: 80, rows: 20 }, g.spawn);
    g.proc().emit("exit", HOST_GONE_EXIT);
    expect(c.exited).toBe(false);
  });
});

describe("long poll", () => {
  it("holds an up-to-date poll until output arrives, and answers with it", async () => {
    const f = fakeSpawn();
    const t = openTerm(ID, null, { cols: 80, rows: 20 }, f.spawn);
    const p = poll(ID, t, 0, -1);
    const reply = termResponse(new Request(`http://127.0.0.1/t?gen=${p.gen}&since=${p.cursor}&wait=20000`), ID, t);
    let done = false;
    void reply.then(() => (done = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    // omp's echo: control bytes first, the redraw a few ms later; both go back in one reply.
    f.proc().stdout.write("\x1b[?25l");
    await new Promise((r) => setTimeout(r, 15));
    f.proc().stdout.write("typed");
    const body = await (await reply).json();
    expect(Buffer.from(body.out, "base64").toString()).toBe("\x1b[?25ltyped");
  });
  it("lets go when the bridge ends, the wait runs out, or the page leaves", async () => {
    const f = fakeSpawn();
    const t = openTerm(ID, null, { cols: 80, rows: 20 }, f.spawn);
    const ac = new AbortController();
    const left = waitOutput(t, t.total, 20_000, ac.signal);
    ac.abort();
    await left;
    await waitOutput(t, t.total, 5);
    const ending = waitOutput(t, t.total, 20_000);
    f.proc().emit("exit", 0);
    await ending;
    expect(t.waiters.size).toBe(0);
  });
});
