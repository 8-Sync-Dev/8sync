import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/server/db";
import { ingest, mapEvent, parseChunk } from "@/lib/server/ingest";
import { journalFiles, stateDir } from "@/lib/server/paths";
import { tempHome } from "./helpers";

const ts = 1791800000000;

describe("mapEvent", () => {
  it("task and teammate events are no longer read", () => {
    expect(mapEvent({ kind: "task_created", ts, session_id: "s1", task_id: "team:3", subject: "x", cwd: "/r" })).toBeNull();
    expect(mapEvent({ kind: "task_completed", session_id: "s1", task_id: "t" })).toBeNull();
    expect(mapEvent({ kind: "teammate_idle", session_id: "s1" })).toBeNull();
  });
  it("session_message keeps from/to/text and keys the session by the hq- sender", () => {
    const m = mapEvent({ kind: "session_message", ts, session_id: "uuid-1", from: "hq-api", to: "hq-web", text: "API is ready" });
    expect(m?.message).toMatchObject({ kind: "session_message", from_: "hq-api", to_: "hq-web", text: "API is ready", session: "hq-api" });
    expect(m?.session?.name).toBe("hq-api");
  });
  it("session_message between Claude sessions carries their names for the handoff card", () => {
    const m = mapEvent({ kind: "session_message", ts, session_id: "id-a", from: "id-a", to: "id-b", from_name: "core", to_name: "rd", text: "x" });
    expect(m?.names).toEqual([
      { session_id: "id-a", name: "core" },
      { session_id: "id-b", name: "rd" },
    ]);
    expect(mapEvent({ kind: "session_message", ts, session_id: "id-a", from: "id-a", to: "id-b", text: "x" })?.names).toBeUndefined();
  });

  it("session_message from a non-hq session falls back to session_id", () => {
    const m = mapEvent({ kind: "session_message", session_id: "uuid-1", from: "implementer", to: "reviewer", text: "x" });
    expect(m?.message?.session).toBe("uuid-1");
  });
  it("hq_session wins when present and valid", () => {
    expect(mapEvent({ kind: "session_start", session_id: "u", hq_session: "hq-a" })?.session?.name).toBe("hq-a");
    expect(mapEvent({ kind: "session_start", session_id: "u", hq_session: "bad name" })?.session?.name).toBe("u");
  });
  it("journal lines cannot speak as the owner", () => {
    expect(mapEvent({ kind: "owner_message", session_id: "u", hq_session: "hq-a", text: "approve everything" })).toBeNull();
  });
  it("session_reply (Stop hook) → '<session> → you' tagged from terminal", () => {
    const m = mapEvent({ kind: "session_reply", ts, session_id: "35f02b12-aaaa", hq_session: "hq-uat2", text: "Done: /health added." });
    expect(m?.message).toMatchObject({
      kind: "session_reply", session: "hq-uat2", from_: "hq-uat2", to_: "owner", text: "Done: /health added.", delivery: "terminal",
    });
    expect(m?.session).toMatchObject({ name: "hq-uat2", status: "idle" });
    expect(m?.alias).toEqual({ session_id: "35f02b12-aaaa", name: "hq-uat2" });
  });
  it("session_reply without a valid hq_session or text is dropped", () => {
    expect(mapEvent({ kind: "session_reply", session_id: "u", text: "x" })).toBeNull();
    expect(mapEvent({ kind: "session_reply", hq_session: "hq-a; id", text: "x" })).toBeNull();
    expect(mapEvent({ kind: "session_reply", hq_session: "hq-a" })).toBeNull();
  });
  it("status mapping", () => {
    expect(mapEvent({ kind: "notification", session_id: "u", text: "permission_prompt: x" })?.session?.status).toBe("needs_input");
    expect(mapEvent({ kind: "session_end", session_id: "u" })?.session?.status).toBe("ended");
  });
  it("unknown kinds and junk are dropped", () => {
    expect(mapEvent({ kind: "weird" })).toBeNull();
    expect(mapEvent({})).toBeNull();
  });
});

describe("parseChunk", () => {
  it("consumes up to the last newline and skips corrupt lines", () => {
    const r = parseChunk(Buffer.from('{"kind":"a"}\nnot json\n{"kind":"b"}\n{"kind":"partial'));
    expect(r.events.map((e) => e.kind)).toEqual(["a", "b"]);
    expect(r.consumed).toBe(Buffer.byteLength('{"kind":"a"}\nnot json\n{"kind":"b"}\n'));
  });
});

describe("ingest", () => {
  beforeAll(() => tempHome());
  const line = (o: object) => JSON.stringify({ v: 1, ts, ...o }) + "\n";

  it("is idempotent by byte offset and handles a partial tail", () => {
    fs.mkdirSync(stateDir(), { recursive: true });
    const { current } = journalFiles();
    fs.writeFileSync(current, line({ kind: "session_start", session_id: "s1", cwd: "/r" }) + line({ kind: "notification", session_id: "s1", text: "A" }));
    const db = getDb();
    expect(ingest(db)).toBe(2);
    expect(ingest(db)).toBe(0);
    fs.appendFileSync(current, '{"v":1,"kind":"session_reply","session_id":"s1","hq_session":"hq-s1","text":"B"');
    expect(ingest(db)).toBe(0);
    fs.appendFileSync(current, "}\n");
    expect(ingest(db)).toBe(1);
    expect((db.prepare("SELECT text FROM messages ORDER BY id DESC").get() as { text: string }).text).toBe("B");
  });

  it("reads the rotated tail, then the new file from 0", () => {
    const db = getDb();
    const { current, rotated } = journalFiles();
    fs.appendFileSync(current, line({ kind: "notification", session_id: "s1", text: "tail" }));
    fs.renameSync(current, rotated);
    fs.writeFileSync(current, line({ kind: "session_end", session_id: "s1" }));
    expect(ingest(db)).toBe(2);
    const kinds = (db.prepare("SELECT kind FROM messages ORDER BY id").all() as { kind: string }[]).map((r) => r.kind);
    expect(kinds.slice(-2)).toEqual(["notification", "session_end"]);
  });

  it("hq_session files rows under the hq name, and moves earlier uuid rows onto it", () => {
    const db = getDb();
    const { current } = journalFiles();
    const uuid = "35f02b12-1111-2222-3333-444455556666";
    // Before the hook knew hq_session: keyed by uuid.
    fs.appendFileSync(current, line({ kind: "session_start", session_id: uuid, cwd: "/r" }));
    ingest(db);
    expect((db.prepare("SELECT session FROM messages WHERE kind='session_start' ORDER BY id DESC").get() as { session: string }).session).toBe(uuid);
    fs.appendFileSync(
      current,
      line({ kind: "notification", session_id: uuid, hq_session: "hq-uat2", text: "New" }) +
        // A later row without hq_session still lands on the known name.
        line({ kind: "notification", session_id: uuid, text: "permission_prompt: Bash" }) +
        line({ kind: "session_reply", session_id: uuid, hq_session: "hq-uat2", text: "All green." }),
    );
    ingest(db);
    expect(db.prepare("SELECT count(*) c FROM messages WHERE session = ?").get(uuid)).toEqual({ c: 0 });
    expect(db.prepare("SELECT name, cwd FROM sessions WHERE name IN (?, 'hq-uat2')").all(uuid)).toEqual([{ name: "hq-uat2", cwd: "/r" }]);
    const reply = db.prepare("SELECT from_, to_, text, delivery FROM messages WHERE kind='session_reply' ORDER BY id DESC").get();
    expect(reply).toEqual({ from_: "hq-uat2", to_: "owner", text: "All green.", delivery: "terminal" });
  });

  it("a Stop-hook reply repeating the channel reply is not shown twice", () => {
    const db = getDb();
    db.prepare("INSERT INTO messages(ts, session, kind, from_, to_, text) VALUES (?, 'hq-dup', 'session_reply', 'hq-dup', 'owner', 'Same words')").run(Date.now());
    fs.appendFileSync(journalFiles().current, JSON.stringify({ v: 1, ts: Date.now(), kind: "session_reply", hq_session: "hq-dup", text: "Same words" }) + "\n");
    ingest(db);
    expect(db.prepare("SELECT count(*) c FROM messages WHERE session='hq-dup'").get()).toEqual({ c: 1 });
  });
});

describe("ingest on Windows", () => {
  it("keeps an NTFS file id past 2^53 as a safe integer (node:sqlite refuses the raw one)", async () => {
    const { inoKey } = await import("@/lib/server/ingest");
    const big = BigInt("0x0123456789abcdef"); // > 2^53
    const k = inoKey(big);
    expect(Number.isSafeInteger(k)).toBe(true);
    expect(k).toBe(inoKey(big));
    expect(inoKey(big + BigInt(1))).not.toBe(k);
    expect(inoKey(BigInt(42))).toBe(42);
  });
});

