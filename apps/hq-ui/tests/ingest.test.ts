import fs from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/lib/server/db";
import { ingest, mapEvent, parseChunk } from "@/lib/server/ingest";
import { journalFiles, stateDir } from "@/lib/server/paths";
import { tempHome } from "./helpers";

const ts = 1791800000000;

describe("mapEvent", () => {
  it("task_created → todo task + timeline row", () => {
    const m = mapEvent({ kind: "task_created", ts, session_id: "s1", task_id: "team:3", subject: "[be] Add /health", role: "backend", cwd: "/r" });
    expect(m?.task).toMatchObject({ task_id: "team:3", status: "todo", subject: "[be] Add /health", role: "backend", session: "s1" });
    expect(m?.message).toMatchObject({ kind: "task_created", text: "[be] Add /health" });
    expect(m?.session).toMatchObject({ name: "s1", cwd: "/r", status: "running" });
  });
  it("task_completed → done", () => {
    expect(mapEvent({ kind: "task_completed", session_id: "s1", task_id: "t" })?.task?.status).toBe("done");
  });
  it("task without id is dropped", () => {
    expect(mapEvent({ kind: "task_created", session_id: "s1" })).toBeNull();
  });
  it("session_message keeps from/to/text and keys the session by the hq- sender", () => {
    const m = mapEvent({ kind: "session_message", ts, session_id: "uuid-1", from: "hq-api", to: "hq-web", text: "API is ready" });
    expect(m?.message).toMatchObject({ kind: "session_message", from_: "hq-api", to_: "hq-web", text: "API is ready", session: "hq-api" });
    expect(m?.session?.name).toBe("hq-api");
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
    expect(mapEvent({ kind: "teammate_idle", session_id: "u" })?.session?.status).toBe("idle");
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
    fs.writeFileSync(current, line({ kind: "session_start", session_id: "s1", cwd: "/r" }) + line({ kind: "task_created", session_id: "s1", task_id: "t1", subject: "A" }));
    const db = getDb();
    expect(ingest(db)).toBe(2);
    expect(ingest(db)).toBe(0);
    fs.appendFileSync(current, '{"v":1,"kind":"task_completed","session_id":"s1","task_id":"t1"');
    expect(ingest(db)).toBe(0);
    fs.appendFileSync(current, "}\n");
    expect(ingest(db)).toBe(1);
    expect((db.prepare("SELECT status FROM tasks WHERE task_id='t1'").get() as { status: string }).status).toBe("done");
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
    fs.appendFileSync(current, line({ kind: "task_created", session_id: uuid, task_id: "u:1", subject: "Old", cwd: "/r" }));
    ingest(db);
    expect((db.prepare("SELECT session FROM tasks WHERE task_id='u:1'").get() as { session: string }).session).toBe(uuid);
    fs.appendFileSync(
      current,
      line({ kind: "task_created", session_id: uuid, hq_session: "hq-uat2", task_id: "u:2", subject: "New" }) +
        // A later row without hq_session still lands on the known name.
        line({ kind: "notification", session_id: uuid, text: "permission_prompt: Bash" }) +
        line({ kind: "session_reply", session_id: uuid, hq_session: "hq-uat2", text: "All green." }),
    );
    ingest(db);
    const tasks = db.prepare("SELECT task_id, session FROM tasks WHERE task_id LIKE 'u:%' ORDER BY task_id").all();
    expect(tasks).toEqual([{ task_id: "u:1", session: "hq-uat2" }, { task_id: "u:2", session: "hq-uat2" }]);
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
