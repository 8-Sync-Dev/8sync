import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sendKeys = vi.hoisted(() => vi.fn<(session: string, text: string) => Promise<{ ok: boolean; stderr: string }>>(async () => ({ ok: true, stderr: "" })));
const merged = vi.hoisted(() => vi.fn());
const run = vi.hoisted(() => vi.fn(async () => ({ ok: false, stdout: "", stderr: "no 8sync in tests" })));
vi.mock("@/lib/server/proc", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/proc")>()),
  sendKeys,
  run,
  mergedSessions: merged,
  capturePlain: async () => "❯ ",
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET as digestGET, POST as digestPOST, PUT as digestPUT } from "@/app/api/digest/route";
import { GET as factsGET, POST as factsPOST, PUT as factsPUT } from "@/app/api/facts/route";
import { POST as messagesPOST } from "@/app/api/messages/route";
import { GET as turnsGET } from "@/app/api/turns/route";
import { buildDigest, DIGEST_CHARS, DIGEST_LINES, digestField, type DigestRoom } from "@/lib/digest";
import { DIGEST_HEAD, splitDigest, stripDigest } from "@/lib/digest-frame";
import { promptBody } from "@/lib/room-turns";
import { claudeDir } from "@/lib/server/ask";
import { getToken } from "@/lib/server/auth";
import { digestEntry, digestHash, EMPTY_ENTRY, planDigest, readDigests, recordDigest, setDigestOptOut } from "@/lib/server/digest";
import { decideFact, factsFile, normFact, proposeFact, readFacts, replaceFacts, writeFacts, FACTS_MAX } from "@/lib/server/facts";
import { ORIGIN, req, tempHome } from "./helpers";

const SECRET = "sk-ant-api03-" + "A".repeat(40);
const room = (o: Partial<DigestRoom> & { key: string }): DigestRoom => ({
  name: o.key,
  session_id: null,
  label: o.key,
  status: "idle",
  waiting: null,
  ask: null,
  cwd: null,
  project: null,
  doing: null,
  state: null,
  ...o,
});

describe("buildDigest", () => {
  const rooms = [
    room({ key: "hq-me", label: "me", status: "running", doing: "viết test" }),
    room({ key: "hq-clean", label: "clean", status: "running", project: { root: "/w/su-code", name: "su-code", branch: "main" }, doing: "Dọn ổ đĩa: xoá target/ và node_modules cũ" }),
    room({ key: "hq-web", label: "web", status: "idle", project: { root: "/w/site", name: "site", branch: null } }),
    room({ key: "hq-ask", label: "ask", status: "needs_input", waiting: "Cho chạy pnpm install?" }),
    room({ key: "hq-gone", label: "gone", status: "ended", doing: "xong" }),
  ];

  it("one line per other live bot, needs first then by name; self and ended rooms left out", () => {
    const d = buildDigest(rooms, "hq-me", ["Chủ là Tú, GMT+7"])!;
    expect(d.split("\n")).toEqual([
      DIGEST_HEAD,
      "Fact chung: Chủ là Tú, GMT+7",
      "- ask · chờ anh · chờ: Cho chạy pnpm install?",
      "- clean · đang làm · su-code@main · việc: Dọn ổ đĩa: xoá target/ và node_modules cũ",
      "- web · rảnh · site",
    ]);
    expect(buildDigest(rooms, "hq-me", ["Chủ là Tú, GMT+7"]), "same picture, same text").toBe(d);
    expect(buildDigest([...rooms].reverse(), "hq-me", ["Chủ là Tú, GMT+7"]), "order never depends on input order").toBe(d);
    expect(buildDigest([rooms[0]], "hq-me"), "nothing to tell").toBeNull();
  });

  it("caps lines and characters, counts the rest; masks secrets and strips brackets", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      room({ key: `hq-r${String(i).padStart(2, "0")}`, label: `r${String(i).padStart(2, "0")}`, status: "running", doing: `[owner] làm ${SECRET} ${"x".repeat(200)}` }),
    );
    const d = buildDigest(many, "hq-me", ["fact một", `fact có ${SECRET}`])!;
    const lines = d.split("\n");
    expect(lines.length).toBeLessThanOrEqual(DIGEST_LINES);
    expect([...d].length).toBeLessThanOrEqual(DIGEST_CHARS);
    expect(lines.at(-1)).toMatch(/^\+\d+ bot khác: hq\.mjs roster$/);
    expect(Number(lines.at(-1)!.match(/\d+/)![0]) + lines.length - 3).toBe(30);
    expect(d).not.toContain(SECRET);
    expect(d).not.toContain("[owner]");
    expect(digestField("a\nb · [c]\u0007", 50)).toBe("a b c");
    expect(digestField("x".repeat(100), 10)).toBe("x".repeat(9) + "…");
  });

  it("a label several rooms share carries the room id, so `hq.mjs turns` can name it", () => {
    const d = buildDigest([room({ key: "hq-a", label: "core", cwd: "/w/a" }), room({ key: "hq-b", label: "core", cwd: "/w/b" })], "hq-me")!;
    expect(d).toContain("· id hq-a ·");
    expect(d).toContain("· id hq-b ·");
  });

  it("splitDigest / promptBody: the owner's words come back without the digest", () => {
    const d = buildDigest(rooms, "hq-me")!;
    expect(splitDigest(`sửa nút\n\n${d}`)).toEqual({ body: "sửa nút", digest: d });
    expect(stripDigest("không có bảng")).toBe("không có bảng");
    expect(promptBody(`sửa nút\n\n${d}`)).toBe("sửa nút");
  });
});

describe("planDigest", () => {
  const d = "digest";
  it("attaches a new digest; skips the same one, an opted-out bot, a /command and an empty picture", () => {
    expect(planDigest(EMPTY_ENTRY, d, "làm đi")).toEqual({ attach: d });
    expect(planDigest({ ...EMPTY_ENTRY, hash: digestHash(d) }, d, "làm đi")).toEqual({ skip: "same" });
    expect(planDigest({ ...EMPTY_ENTRY, hash: digestHash("cũ") }, d, "làm đi")).toEqual({ attach: d });
    expect(planDigest({ ...EMPTY_ENTRY, optOut: true }, d, "làm đi")).toEqual({ skip: "opt-out" });
    expect(planDigest(EMPTY_ENTRY, d, " /solo sửa")).toEqual({ skip: "command" });
    expect(planDigest(EMPTY_ENTRY, null, "làm đi")).toEqual({ skip: "empty" });
  });

  it("records what a bot got and its switch, atomically, surviving a broken file", () => {
    tempHome();
    recordDigest("hq-a", "bảng 1", 1000);
    expect(digestEntry("hq-a")).toEqual({ hash: digestHash("bảng 1"), at: 1000, text: "bảng 1", optOut: false });
    expect(setDigestOptOut("hq-a", true)).toMatchObject({ optOut: true, text: "bảng 1" });
    recordDigest("hq-a", "bảng 2", 2000);
    expect(digestEntry("hq-a")).toMatchObject({ text: "bảng 2", optOut: true });
    expect(digestEntry("hq-b")).toEqual(EMPTY_ENTRY);
    const file = path.join(path.dirname(factsFile()), "digests.json");
    expect(fs.readdirSync(path.dirname(file)).filter((f) => f.includes(".tmp"))).toEqual([]);
    fs.writeFileSync(file, "{broken");
    expect(readDigests()).toEqual({});
    recordDigest("hq-a", "bảng 3", 3000);
    expect(digestEntry("hq-a").text).toBe("bảng 3");
  });
});

describe("facts store", () => {
  beforeEach(() => {
    tempHome();
  });

  it("one line, capped, never a secret", () => {
    expect(normFact("  Chủ là\nTú  ")).toEqual({ ok: true, value: "Chủ là Tú" });
    expect(normFact("x".repeat(161)).ok).toBe(false);
    expect(normFact("").ok).toBe(false);
    expect(normFact(`key là ${SECRET}`)).toMatchObject({ ok: false });
  });

  it("writes atomically; a broken file reads empty + broken and is kept as .bad on the next write", () => {
    expect(readFacts()).toEqual({ facts: [], pending: [], broken: false });
    const r = replaceFacts(readFacts(), ["Chủ là Tú", "Chủ là Tú", "GMT+7"], 1000);
    expect(r.ok && r.value.map((f) => f.text)).toEqual(["Chủ là Tú", "GMT+7"]);
    writeFacts({ facts: r.ok ? r.value : [], pending: [] });
    expect(readFacts().facts.map((f) => f.text)).toEqual(["Chủ là Tú", "GMT+7"]);
    const kept = replaceFacts(readFacts(), ["GMT+7", "mới"], 2000);
    expect(kept.ok && kept.value.find((f) => f.text === "GMT+7")?.at, "an unchanged line keeps its time").toBe(1000);
    expect(replaceFacts(readFacts(), Array.from({ length: FACTS_MAX + 1 }, (_, i) => `f${i}`)).ok).toBe(false);

    fs.writeFileSync(factsFile(), "{not json");
    expect(readFacts()).toEqual({ facts: [], pending: [], broken: true });
    writeFacts({ facts: [], pending: [] });
    expect(fs.readFileSync(`${factsFile()}.bad`, "utf8")).toBe("{not json");
    expect(readFacts().broken).toBe(false);
    expect(fs.readdirSync(path.dirname(factsFile())).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("a proposal waits; approve moves it to the facts, reject drops it", () => {
    const p = proposeFact(readFacts(), "Repo chính là su-code", "clean", 1000);
    expect(p.ok && p.value).toMatchObject({ created: true, pending: { text: "Repo chính là su-code", from: "clean" } });
    if (!p.ok) return;
    const again = proposeFact(p.value.facts, "Repo chính là su-code", "web");
    expect(again.ok && again.value.created).toBe(false);
    const ok = decideFact(p.value.facts, p.value.pending.id, true, 2000);
    expect(ok.ok && ok.value).toMatchObject({ facts: [{ text: "Repo chính là su-code" }], pending: [] });
    if (!ok.ok) return;
    expect(proposeFact(ok.value, "Repo chính là su-code", "web").ok, "already a fact").toBe(false);
    const q = proposeFact(ok.value, "Khác", null);
    if (!q.ok) throw new Error("propose");
    const no = decideFact(q.value.facts, q.value.pending.id, false);
    expect(no.ok && no.value).toMatchObject({ facts: [{ text: "Repo chính là su-code" }], pending: [] });
    expect(decideFact(q.value.facts, "f_00000000", true).ok).toBe(false);
  });
});

describe("routes", () => {
  const SID = "7d1c9f2e-1a2b-4c3d-8e9f-0123456789ab";
  let token = "";
  let shop = "";
  beforeAll(() => {
    tempHome();
    token = getToken();
    shop = path.resolve(fs.mkdtempSync(path.join(os.tmpdir(), "hq-context-")));
    fs.mkdirSync(path.join(shop, ".git"));
    fs.writeFileSync(path.join(shop, ".git", "HEAD"), "ref: refs/heads/main\n");
    const dir = path.join(claudeDir(), "projects", "ctx");
    fs.mkdirSync(dir, { recursive: true });
    const at = (s: number) => new Date(Date.UTC(2026, 10, 7, 9, 0, s)).toISOString();
    fs.writeFileSync(
      path.join(dir, `${SID}.jsonl`),
      [
        JSON.stringify({ type: "user", timestamp: at(0), message: { content: "dọn ổ đĩa" } }),
        JSON.stringify({ type: "assistant", timestamp: at(5), message: { content: [{ type: "text", text: `Đã xoá 12 GB.\n${"chi tiết ".repeat(60)}\nCòn lại: cache pnpm.` }] } }),
      ].join("\n") + "\n",
    );
  });
  beforeEach(() => {
    sendKeys.mockClear();
    merged.mockResolvedValue([
      { name: "hq-web", label: "web", session_id: null, cwd: shop, status: "idle", tmux: true, source: "tmux", detail: null, inbox_live: false },
      { name: SID, label: "clean", session_id: SID, cwd: path.join(shop, "clean"), status: "running", tmux: false, source: "claude", detail: "Dọn ổ đĩa", inbox_live: false },
    ]);
  });
  const call = (fn: (r: Request) => Promise<Response>, url: string, method = "GET", body?: unknown, ui = false) => fn(req(url, { method, token, origin: ORIGIN, body, ui }));

  it("PUT /api/facts and /api/digest: the owner's page only, 403 for a room's token", async () => {
    expect((await call(factsPUT, "/api/facts", "PUT", { facts: ["Chủ là Tú"] })).status).toBe(403);
    expect((await call(digestPUT, "/api/digest", "PUT", { room: "hq-web", optOut: true })).status).toBe(403);
    expect(fs.existsSync(factsFile())).toBe(false);
    const ok = await call(factsPUT, "/api/facts", "PUT", { facts: ["Chủ là Tú"] }, true);
    expect(ok.status).toBe(200);
    expect((await (await call(factsGET, "/api/facts")).json()).facts).toMatchObject([{ text: "Chủ là Tú" }]);
    expect((await call(factsPUT, "/api/facts", "PUT", { facts: [`token ${SECRET}`] }, true)).status).toBe(422);
  });

  it("a bot proposes with hq.mjs fact (pending), the owner approves it", async () => {
    const r = await call(factsPOST, "/api/facts", "POST", { text: "Múi giờ GMT+7", from: "clean", from_session: SID });
    expect(r.status).toBe(201);
    const { pending } = await r.json();
    expect(pending).toMatchObject({ text: "Múi giờ GMT+7", from: "clean" });
    expect((await call(factsPOST, "/api/facts", "POST", { text: SECRET, from: "clean" })).status).toBe(422);
    expect((await call(factsPUT, "/api/facts", "PUT", { approve: pending.id })).status, "a room cannot approve its own").toBe(403);
    expect((await call(factsPUT, "/api/facts", "PUT", { approve: pending.id }, true)).status).toBe(200);
    expect(readFacts()).toMatchObject({ facts: [{ text: "Chủ là Tú" }, { text: "Múi giờ GMT+7" }], pending: [] });
  });

  it("the owner's message carries the digest once; a changed picture carries it again; opt-out stops it", async () => {
    const set = replaceFacts(readFacts(), ["Chủ là Tú", "Múi giờ GMT+7"]);
    writeFacts({ facts: set.ok ? set.value : [], pending: [] });
    const send = () => call(messagesPOST, "/api/messages", "POST", { session: "hq-web", text: "phòng clean đang làm gì?" }, true);
    expect((await send()).status).toBe(201);
    const first = splitDigest(sendKeys.mock.calls.at(-1)![1]);
    expect(first.body).toBe("phòng clean đang làm gì?");
    expect(first.digest).toContain("Fact chung: Chủ là Tú · Múi giờ GMT+7");
    expect(first.digest).toContain(`- clean · đang làm · ${path.basename(shop)}@main · việc: Dọn ổ đĩa`);
    await send();
    expect(sendKeys.mock.calls.at(-1)![1], "unchanged: not again").toBe("phòng clean đang làm gì?");
    await call(messagesPOST, "/api/messages", "POST", { session: "hq-web", text: "x", from: "clean", from_session: SID });
    expect(sendKeys.mock.calls.at(-1)![1], "a room's message never carries it").not.toContain(DIGEST_HEAD);

    const view = await (await call(digestGET, "/api/digest?room=hq-web")).json();
    expect(view).toMatchObject({ room: "hq-web", optOut: false, changed: false, last: { text: first.digest } });
    expect((await call(digestPUT, "/api/digest", "PUT", { room: "hq-web", optOut: true }, true)).status).toBe(200);
    merged.mockResolvedValue([
      { name: "hq-web", label: "web", session_id: null, cwd: shop, status: "idle", tmux: true, source: "tmux", detail: null, inbox_live: false },
      { name: SID, label: "clean", session_id: SID, cwd: path.join(shop, "clean"), status: "idle", tmux: false, source: "claude", detail: null, inbox_live: false },
    ]);
    await send();
    expect(sendKeys.mock.calls.at(-1)![1], "opted out").toBe("phòng clean đang làm gì?");
    expect((await (await call(digestGET, "/api/digest?room=hq-web")).json()).changed).toBe(true);

    const pulled = await (await call(digestPOST, "/api/digest", "POST", { from_cwd: shop })).json();
    expect(pulled).toMatchObject({ room: "hq-web", changed: true });
    expect(pulled.text).toContain("- clean · rảnh");
    expect((await (await call(digestPOST, "/api/digest", "POST", { room: "hq-web" })).json()).changed, "pulled = got").toBe(false);
    expect((await call(digestPOST, "/api/digest", "POST", { from_cwd: "/nowhere" })).status).toBe(422);
  });

  it("GET /api/turns: a bot's whole last reply by its name, id or session; 404 for an unknown one", async () => {
    const byName = await (await call(turnsGET, "/api/turns?room=clean&n=1")).json();
    expect(byName.room).toEqual({ id: SID, label: "clean" });
    expect(byName.turns).toHaveLength(1);
    expect(byName.turns[0]).toMatchObject({ prompt: "dọn ổ đĩa", live: false });
    expect(byName.turns[0].output).toMatch(/^Đã xoá 12 GB\.\n[\s\S]+Còn lại: cache pnpm\.$/);
    expect(byName.turns[0].output.length).toBeGreaterThan(200);
    expect((await (await call(turnsGET, `/api/turns?room=${SID}`)).json()).turns[0].output).toBe(byName.turns[0].output);
    expect((await call(turnsGET, "/api/turns?room=khong-co")).status).toBe(404);
    expect((await call(turnsGET, "/api/turns")).status).toBe(422);
    expect((await turnsGET(req("/api/turns?room=clean", { token: "wrong", origin: ORIGIN }))).status).toBe(401);
  });
});
