import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn<(...a: unknown[]) => Promise<{ ok: boolean; stdout: string; stderr: string }>>(async () => ({ ok: true, stdout: "ok", stderr: "" })));
const room = vi.hoisted(() => ({ cwd: "" }));
const sessions = vi.hoisted(() => vi.fn(async () => [{ name: "s1", cwd: room.cwd, status: "running" }]));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  run,
  mergedSessions: sessions,
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "@/app/api/preview/eye/route";
import { EyeNoteBox } from "@/components/hq/preview-view";
import { EYE_DEBOUNCE_MS, eyeDue, eyeMessage, eyeNote, eyeSend, imageKey, type EyePending } from "@/lib/eye";
import { LANES, type Board, type Card, type Closed } from "@/lib/lanes";
import { rootKey, type PreviewItem, type ProjectPreviews } from "@/lib/preview";
import { getToken } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { EYE_BACKOFF_MS, eyeArgs, eyeAutoTick, eyeSince, eyeTick, setEye } from "@/lib/server/eye";
import { ORIGIN, req, tempHome } from "./helpers";

const ROOT = "/repo";
const card = (over: Partial<Card>): Card => ({ id: 4, text: "Ghost toggle", lane: "qa", check: null, label: null, claim: null, pr: null, sha: null, bounces: 0, note: null, added: 0, ...over });
const img = (card: number | null, name: string, at: number, over: Partial<PreviewItem> = {}): PreviewItem => ({
  id: `${card}-${name}`,
  project: "repo",
  root: ROOT,
  rel: `.claude/worktrees/card-${card}/qa/evidence/${name}`,
  worktree: `card-${card}`,
  branch: null,
  ref: null,
  card,
  at,
  timeFrom: "file",
  size: name.length * 100,
  ...over,
});
const board = (open: Card[], closed: Closed[] = []): Board => ({
  lanes: Object.fromEntries(LANES.map((l) => [l.key, open.filter((c) => c.lane === l.key)])) as Board["lanes"],
  closed,
});

describe("eyeDue + eyeSend", () => {
  const SINCE = 1_000;
  const plan = (b: Board, a: Parameters<typeof eyeDue>[0]) => eyeDue(a).flatMap((d) => eyeSend(d, b) ?? []);
  it("waits until a card has had no new image for the debounce, then one message per card with ≤ 6 newest paths", () => {
    const b = board([card({ id: 4 }), card({ id: 5, lane: "building", text: "Menu" })]);
    const pending: EyePending = new Map();
    const sent = new Set<string>();
    const items = [img(4, "a.png", 2_000), img(5, "m.png", 2_100)];
    expect(plan(b, { items, since: SINCE, sent, pending, now: 10_000 })).toEqual([]);
    // A second shot of #4 restarts its clock; #5 goes out alone.
    const more = [img(4, "b.png", 3_000), ...items];
    const at = (now: number) => plan(b, { items: more, since: SINCE, sent, pending, now }).map((s) => s.card);
    expect(at(10_000 + EYE_DEBOUNCE_MS - 1)).toEqual([]);
    expect(at(10_000 + EYE_DEBOUNCE_MS)).toEqual([5]);
    expect(at(10_000 + 2 * EYE_DEBOUNCE_MS - 2)).toEqual([5]);
    expect(at(10_000 + 2 * EYE_DEBOUNCE_MS - 1)).toEqual([4, 5]);
    // Eight new: the six newest go out and only those count as sent; the two older follow later.
    const eight = Array.from({ length: 8 }, (_, i) => img(4, `s${i}.png`, 5_000 + i));
    const p2: EyePending = new Map();
    plan(b, { items: eight, since: SINCE, sent, pending: p2, now: 0 });
    const [s] = plan(b, { items: eight, since: SINCE, sent, pending: p2, now: EYE_DEBOUNCE_MS });
    expect(s.keys).toEqual(eight.slice(2).reverse().map(imageKey));
    expect(s.text.startsWith('[ảnh mới] card #4 (lane qa): "Ghost toggle" · ảnh: /repo/.claude/worktrees/card-4/qa/evidence/s7.png, ')).toBe(true);
    expect(s.text.split(", ")).toHaveLength(6);
    expect(s.text).not.toContain("s1.png");
    for (const k of s.keys) sent.add(k);
    p2.delete(4);
    plan(b, { items: eight, since: SINCE, sent, pending: p2, now: 2 * EYE_DEBOUNCE_MS });
    const [rest] = plan(b, { items: eight, since: SINCE, sent, pending: p2, now: 3 * EYE_DEBOUNCE_MS });
    expect(rest.keys).toEqual([imageKey(eight[1]), imageKey(eight[0])]);
  });

  it("never sends closed or gone cards, pre-switch images, images only in a ref, ones already sent or backing off", () => {
    const b = board([card({ id: 4 })], [{ id: 9, text: "done", state: "done", by: null, at: 1 }]);
    const pending: EyePending = new Map();
    const items = [img(9, "closed.png", 2_000), img(4, "old.png", 500), img(4, "main.png", 2_000, { ref: "origin/main" }), img(4, "sent.png", 2_000), img(7, "gone.png", 2_000), img(null, "x.png", 2_000), img(8, "wait.png", 2_000)];
    const sent = new Set([imageKey(items[3])]);
    const a = { items, since: 1_000, sent, pending, skip: (c: number) => c === 8 };
    eyeDue({ ...a, now: 0 });
    const due = eyeDue({ ...a, now: 10 * EYE_DEBOUNCE_MS });
    expect(due.map((d) => d.card).sort()).toEqual([7, 9]);
    expect(due.map((d) => eyeSend(d, b))).toEqual([null, null]);
  });

  it("clips a long title to one line", () => {
    expect(eyeMessage(3, "qa", `${"x".repeat(200)}\nAC: y`, ["/a.png"])).toMatch(/^\[ảnh mới\] card #3 \(lane qa\): "x{79}…" · ảnh: \/a\.png$/);
  });
});

describe("lightbox note", () => {
  it("picks the latest [soi ảnh] note, not a later note of another room", () => {
    const c = card({
      history: [
        { at: 1, room: "eye", text: "[soi ảnh] Đạt: cũ" },
        { at: 2, room: "eye", text: "[soi ảnh] Đạt: menu · Lệch AC: nút che chữ (b.png)" },
        { at: 3, room: "qa", text: "building → qa: PR #8", from: "building", to: "qa" },
      ],
    });
    expect(eyeNote(c)?.text).toContain("nút che chữ");
    expect(eyeNote(card({ note: { room: "eye", text: "[soi ảnh] Đạt: x", at: 1 } }))?.at).toBe(1);
    expect(eyeNote(card({ history: [{ at: 1, room: "qa", text: "qa ok" }] }))).toBeNull();
    const html = renderToStaticMarkup(createElement(EyeNoteBox, { step: eyeNote(c)!, now: 60_002 }));
    expect(html).toContain("Nhận xét soi ảnh");
    expect(html).toContain("nút che chữ (b.png)");
  });
});

describe("switch + tick", () => {
  let token = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-eye-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    room.cwd = path.resolve(dir);
  });
  beforeEach(() => run.mockClear());
  const post = (body: unknown, auth = true, origin: string | null = ORIGIN) => POST(req("/api/preview/eye", { method: "POST", token: auth ? token : null, origin, body }));

  it("is gated like the board routes and runs only the fixed argv in a project HQ shows", async () => {
    expect(eyeArgs(true)).toEqual(["ccc", "auto", "up", "--add", "eye"]);
    expect(eyeArgs(false)).toEqual(["ccc", "auto", "down", "--only", "eye"]);
    expect((await post({ root: room.cwd, on: true }, false)).status).toBe(401);
    expect((await post({ root: room.cwd, on: true }, true, "http://evil.example")).status).toBe(403);
    expect((await post({ root: room.cwd, on: "yes" })).status).toBe(422);
    expect((await post({ root: path.join(os.tmpdir(), "not-a-project"), on: true })).status).toBe(409);
    expect(run).not.toHaveBeenCalled();
    expect(eyeSince(getDb(), room.cwd)).toBeNull();

    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: team của dự án này chưa chạy" });
    const no = await post({ root: room.cwd, on: true });
    expect(no.status).toBe(502);
    expect((await no.json()).error).toContain("chưa chạy");
    expect(eyeSince(getDb(), room.cwd)).toBeNull();

    expect((await post({ root: room.cwd.toUpperCase(), on: true })).status).toBe(200);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "up", "--add", "eye"], 180_000, room.cwd);
    expect(eyeSince(getDb(), room.cwd)).not.toBeNull();
    expect((await post({ root: room.cwd, on: false })).status).toBe(200);
    expect(run).toHaveBeenLastCalledWith("8sync", ["ccc", "auto", "down", "--only", "eye"], 60_000, room.cwd);
    expect(eyeSince(getDb(), room.cwd)).toBeNull();
  });

  it("off: no board read, no message; on: one message per card, never again after an HQ restart", async () => {
    const db = getDb();
    const b = board([card({ id: 4 })]);
    const reads = vi.fn(async (p: { root: string; name: string }) => ({ ...p, board: b, error: null }));
    const proj = (items: PreviewItem[]): ProjectPreviews[] => [{ root: ROOT, name: "repo", main: null, items }];
    const old = img(4, "old.png", 1_000);
    expect(await eyeTick(db, proj([old]), 5_000, reads)).toEqual([]);
    expect(reads).not.toHaveBeenCalled();

    run.mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    await setEye(db, ROOT, true, 2_000);
    run.mockClear();
    const shots = [img(4, "a.png", 3_000), old];
    // Only pre-switch images: nothing to read.
    expect(await eyeTick(db, proj([old]), 4_000, reads)).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(await eyeTick(db, proj(shots), 4_000, reads)).toEqual([]);
    expect(await eyeTick(db, proj(shots), 4_000 + EYE_DEBOUNCE_MS, reads)).toEqual([{ root: ROOT, card: 4 }]);
    expect(run).toHaveBeenCalledTimes(1);
    const [cmd, argv, , cwd] = run.mock.calls[0] as [string, string[], number, string];
    expect([cmd, argv.slice(0, 3), cwd]).toEqual(["8sync", ["ccc", "msg", "eye"], ROOT]);
    expect(argv[3]).toBe('[ảnh mới] card #4 (lane qa): "Ghost toggle" · ảnh: /repo/.claude/worktrees/card-4/qa/evidence/a.png');

    // HQ restarts: memory gone, the DB remembers what went out.
    (globalThis as { __hqEye?: unknown }).__hqEye = undefined;
    reads.mockClear();
    for (const now of [10_000_000, 10_000_000 + EYE_DEBOUNCE_MS]) expect(await eyeTick(db, proj(shots), now, reads)).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);

    // A failed send backs that card off for EYE_BACKOFF_MS (no retry every poll), never marked sent.
    const next = [img(4, "c.png", 20_000_000), ...shots];
    const T = 20_000_000;
    await eyeTick(db, proj(next), T, reads);
    run.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "x" });
    expect(await eyeTick(db, proj(next), T + EYE_DEBOUNCE_MS, reads)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
    reads.mockClear();
    for (const now of [T + EYE_DEBOUNCE_MS + 1, T + EYE_DEBOUNCE_MS + EYE_BACKOFF_MS - 1]) expect(await eyeTick(db, proj(next), now, reads)).toEqual([]);
    expect([reads.mock.calls.length, run.mock.calls.length]).toEqual([0, 2]);
    // Backoff over: the debounce runs again, then it goes out.
    const back = T + EYE_DEBOUNCE_MS + EYE_BACKOFF_MS;
    expect(await eyeTick(db, proj(next), back, reads)).toEqual([]);
    expect(await eyeTick(db, proj(next), back + EYE_DEBOUNCE_MS, reads)).toEqual([{ root: ROOT, card: 4 }]);
    expect((run.mock.calls.at(-1) as unknown as [string, string[]])[1][3]).not.toContain("a.png");
  });

  it("a closed card's new images read the board once, then back off instead of every poll", async () => {
    const db = getDb();
    (globalThis as { __hqEye?: unknown }).__hqEye = undefined;
    const b = board([], [{ id: 9, text: "done", state: "done", by: null, at: 1 }]);
    const reads = vi.fn(async (p: { root: string; name: string }) => ({ ...p, board: b, error: null }));
    const items = [img(9, "late.png", 30_000_000)];
    const proj: ProjectPreviews[] = [{ root: ROOT, name: "repo", main: null, items }];
    const T = 30_000_000;
    for (const now of [T, T + EYE_DEBOUNCE_MS, T + EYE_DEBOUNCE_MS + 1, T + EYE_DEBOUNCE_MS + EYE_BACKOFF_MS - 1]) expect(await eyeTick(db, proj, now, reads)).toEqual([]);
    expect(reads).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("eye from the auto poll", () => {
  it("does nothing while every switch is off; one run at a time; sends whatever tab is open", async () => {
    tempHome();
    const db = getDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hq-eye-auto-"));
    fs.mkdirSync(path.join(dir, ".git"));
    fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
    room.cwd = path.resolve(dir);
    sessions.mockClear();
    run.mockClear();
    expect(await eyeAutoTick(db)).toEqual([]);
    expect(sessions).not.toHaveBeenCalled();

    const t0 = Date.now();
    db.prepare("INSERT INTO eye_on(key, root, since) VALUES (?, ?, ?)").run(rootKey(room.cwd), room.cwd, t0 - 1_000);
    fs.mkdirSync(path.join(dir, "qa", "evidence"), { recursive: true });
    fs.writeFileSync(path.join(dir, "qa", "evidence", "card-4-menu.png"), "png");
    // `auto board --json` as the CLI prints it (lib/lanes.ts parseBoard).
    const b = { schema: 1, lanes: [{ lane: "qa", cards: [{ id: 4, text: "Menu", added: 1 }] }], closed: [] };
    run.mockImplementation(async (...a: unknown[]) => ({ ok: true, stdout: (a[1] as string[])[2] === "board" ? JSON.stringify(b) : "", stderr: "" }));
    const [first, second] = await Promise.all([eyeAutoTick(db), eyeAutoTick(db)]);
    expect([first, second]).toEqual([[], []]);
    expect(sessions).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0 + EYE_DEBOUNCE_MS + 5_000);
    try {
      expect(await eyeAutoTick(db)).toEqual([{ root: room.cwd, card: 4 }]);
      const msg = run.mock.calls.find((c) => (c[1] as string[])[1] === "msg");
      expect(msg?.[1]).toEqual(["ccc", "msg", "eye", expect.stringMatching(/^\[ảnh mới\] card #4 \(lane qa\): "Menu" · ảnh: .*card-4-menu\.png$/)]);
    } finally {
      vi.useRealTimers();
      run.mockReset();
    }
  });
});
