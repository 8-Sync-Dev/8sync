import { beforeAll, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/content/comments/route";
import { POST as SEND } from "@/app/api/content/comments/send/route";
import { deniedText } from "@/lib/access";
import { COMMENT_MAX, commentsTaskText, type CommentList, type ContentComment } from "@/lib/content-comments";
import { getToken, sessionSecret } from "@/lib/server/auth";
import { addComment, listComments, sendComments } from "@/lib/server/content-comments";
import { getDb } from "@/lib/server/db";
import { createInvite, GUEST_COOKIE, guestCookie } from "@/lib/server/invites";
import { ORIGIN, req, tempHome } from "./helpers";

// HQ's own DB in a temp HOME; the content DB is never configured here (the send route answers 404).
let token = "";
const call = (method: string, q: string, body?: unknown) => req(`/api/content/comments${q}`, { method, token, origin: method === "GET" ? null : ORIGIN, body });
const ROOM = "omp-2364d8b9ca3a61ed";
const IT = { id: 77, title: "Bài thử", fb_page: "8 Sync" };

beforeAll(() => {
  tempHome();
  token = getToken();
});

describe("/api/content/comments (Góp ý drafts, owner 2026-11-06)", () => {
  it("is owner only: a guest of any role gets 403", async () => {
    for (const role of ["viewer", "editor"] as const) {
      const inv = createInvite({ label: `khách ${role}`, role, days: 7 }, Date.now()).invite;
      const cookie = guestCookie({ id: inv.id, role, issued: Date.now() }, sessionSecret());
      const headers = new Headers({ host: "127.0.0.1:8740", cookie: `${GUEST_COOKIE}=${cookie}`, origin: ORIGIN, "content-type": "application/json" });
      const list = await GET(new Request(`${ORIGIN}/api/content/comments?item=1`, { headers: new Headers({ host: "127.0.0.1:8740", cookie: `${GUEST_COOKIE}=${cookie}` }) }));
      expect(list.status).toBe(403);
      expect(((await list.json()) as { error: string }).error).toBe(deniedText(role));
      const add = await POST(new Request(`${ORIGIN}/api/content/comments`, { method: "POST", headers, body: JSON.stringify({ item: 1, text: "x" }) }));
      expect(add.status).toBe(403);
      const send = await SEND(new Request(`${ORIGIN}/api/content/comments/send`, { method: "POST", headers, body: JSON.stringify({ item: 1 }) }));
      expect(send.status).toBe(403);
    }
    expect(listComments(getDb(), 1).drafts).toEqual([]);
  });

  it("adds, edits and deletes drafts; each answer carries the lists", async () => {
    const a = await POST(call("POST", "", { item: 10, text: "  ảnh bìa tối quá  " }));
    expect(a.status).toBe(201);
    const first = (await a.json()) as CommentList & { comment: ContentComment };
    expect(first.comment).toMatchObject({ item_id: 10, text: "ảnh bìa tối quá", sent_at: null });
    const b = (await (await POST(call("POST", "", { item: 10, text: "đổi câu mở đầu\r\ndòng hai" }))).json()) as CommentList & { comment: ContentComment };
    expect(b.drafts.map((d) => d.text)).toEqual(["ảnh bìa tối quá", "đổi câu mở đầu\ndòng hai"]);

    const e = await PATCH(call("PATCH", `?id=${first.comment.id}`, { text: "ảnh bìa sáng lên" }));
    expect(e.status).toBe(200);
    expect(((await e.json()) as CommentList).drafts[0].text).toBe("ảnh bìa sáng lên");

    const d = await DELETE(call("DELETE", `?id=${b.comment.id}`));
    expect(d.status).toBe(200);
    expect(((await d.json()) as CommentList).drafts.map((x) => x.text)).toEqual(["ảnh bìa sáng lên"]);
    expect((await DELETE(call("DELETE", `?id=${b.comment.id}`))).status).toBe(404);
    expect((await PATCH(call("PATCH", "?id=999999", { text: "x" }))).status).toBe(404);

    const listed = (await (await GET(call("GET", "?item=10"))).json()) as CommentList;
    expect(listed.drafts).toHaveLength(1);
    expect(listed.sent).toEqual([]);
    // Another item's drafts are its own.
    expect(((await (await GET(call("GET", "?item=11"))).json()) as CommentList).drafts).toEqual([]);
  });

  it("refuses an empty, too long or control-character text and a bad item or id", async () => {
    for (const text of ["", "   \n ", "a".repeat(COMMENT_MAX + 1), "có \u0007 chuông", 42]) {
      expect((await POST(call("POST", "", { item: 12, text }))).status, JSON.stringify(text).slice(0, 20)).toBe(422);
    }
    expect((await POST(call("POST", "", { item: 12, text: "é".repeat(COMMENT_MAX) }))).status).toBe(201);
    expect((await POST(call("POST", "", { item: 12, text: "dòng\ttab\nxuống dòng" }))).status).toBe(201);
    expect((await POST(call("POST", "", { item: 0, text: "x" }))).status).toBe(400);
    expect((await POST(call("POST", "", { item: "abc", text: "x" }))).status).toBe(400);
    expect((await GET(call("GET", ""))).status).toBe(400);
    expect((await PATCH(call("PATCH", "?id=x", { text: "x" }))).status).toBe(400);
    const id = listComments(getDb(), 12).drafts[0].id;
    expect((await PATCH(call("PATCH", `?id=${id}`, { text: "" }))).status).toBe(422);
  });

  it("the send route answers 404 while no content DB is configured", async () => {
    const res = await SEND(req("/api/content/comments/send", { method: "POST", token, origin: ORIGIN, body: { item: 77, session: ROOM } }));
    expect(res.status).toBe(404);
    expect((await SEND(req("/api/content/comments/send", { method: "POST", token, origin: ORIGIN, body: { item: "x" } }))).status).toBe(400);
  });
});

describe("sendComments", () => {
  it("sends every draft in ONE message, numbered under the item header, then marks them sent", async () => {
    const db = getDb();
    const t0 = 1_800_000_000_000;
    addComment(db, IT.id, "ảnh bìa tối quá", t0);
    addComment(db, IT.id, "đổi câu mở đầu\nngắn hơn", t0 + 1);
    const calls: [string, string][] = [];
    const r = await sendComments(db, IT, { session: ROOM, base: "cpa-live · content-post-agency" }, async (s, text) => (calls.push([s, text]), { delivery: "inbox", live: true, error: null }), t0 + 5);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(ROOM);
    expect(calls[0][1]).toBe(commentsTaskText(IT, ["ảnh bìa tối quá", "đổi câu mở đầu\nngắn hơn"]));
    expect(calls[0][1]).toContain("Góp ý của chủ (2):\n1. ảnh bìa tối quá\n2. đổi câu mở đầu\n   ngắn hơn");
    expect(calls[0][1]).toContain("[Nội dung #77]");
    expect(r.count).toBe(2);
    expect(r.comments.drafts).toEqual([]);
    expect(r.comments.sent.map((c) => [c.text, c.sent_at, c.sent_to, c.sent_label])).toEqual([
      ["ảnh bìa tối quá", t0 + 5, ROOM, "cpa-live · content-post-agency"],
      ["đổi câu mở đầu\nngắn hơn", t0 + 5, ROOM, "cpa-live · content-post-agency"],
    ]);
    // A sent comment is history: not editable, not deletable.
    const sentId = r.comments.sent[0].id;
    expect((await PATCH(call("PATCH", `?id=${sentId}`, { text: "khác" }))).status).toBe(409);
    expect((await DELETE(call("DELETE", `?id=${sentId}`))).status).toBe(409);
    // Nothing left to send.
    await expect(sendComments(db, IT, { session: ROOM }, async () => ({ delivery: "inbox", error: null }))).rejects.toMatchObject({ status: 409 });
  });

  it("a failed delivery (answered or thrown) keeps every draft and says so", async () => {
    const db = getDb();
    const item = { ...IT, id: 78 };
    addComment(db, item.id, "một");
    addComment(db, item.id, "hai");
    await expect(sendComments(db, item, { session: ROOM }, async () => ({ delivery: "failed", error: "phòng tắt" }))).rejects.toMatchObject({
      status: 502,
      message: "Chưa gửi được góp ý, vẫn giữ nháp: phòng tắt",
    });
    await expect(
      sendComments(db, item, { session: ROOM }, async () => {
        throw new Error("đĩa đầy");
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(listComments(db, item.id)).toMatchObject({ drafts: [{ text: "một" }, { text: "hai" }], sent: [] });
  });

  it("refuses a missing room or a message over the limit without delivering", async () => {
    const db = getDb();
    const item = { ...IT, id: 79 };
    let delivered = 0;
    const deliver = async () => (delivered++, { delivery: "inbox", error: null });
    addComment(db, item.id, "x");
    await expect(sendComments(db, item, { session: null }, deliver)).rejects.toMatchObject({ status: 422 });
    await expect(sendComments(db, item, { session: "không phải id" }, deliver)).rejects.toMatchObject({ status: 422 });
    await expect(sendComments(db, item, { session: ROOM, base: "b".repeat(201) }, deliver)).rejects.toMatchObject({ status: 422 });
    for (let i = 0; i < 3; i++) addComment(db, item.id, "d".repeat(COMMENT_MAX));
    await expect(sendComments(db, item, { session: ROOM }, deliver)).rejects.toMatchObject({ status: 422 });
    expect(delivered).toBe(0);
    expect(listComments(db, item.id).drafts).toHaveLength(4);
  });
});
