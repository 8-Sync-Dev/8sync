import { describe, expect, it } from "vitest";
import { buildTeamThread, partyKey, type ThreadRow } from "@/lib/team-thread";

const row = (id: number, ts: number, kind: string, session: string | null, extra: Partial<ThreadRow> = {}): ThreadRow => ({
  id, ts, kind, session, from_: null, to_: null, text: null, ...extra,
});

const ROWS: ThreadRow[] = [
  row(3, 300, "session_message", "hq-a", { from_: "hq-a", to_: "hq-b", text: "please review" }),
  row(1, 100, "owner_message", "hq-a", { from_: "owner", to_: "hq-a", text: "go" }),
  row(2, 200, "session_reply", "hq-a", { from_: "hq-a", to_: "owner", text: "done" }),
  row(4, 400, "task_created", "hq-b", { text: "Review PR" }),
  row(5, 500, "task_completed", "hq-b", { text: "Review PR" }),
  row(6, 600, "notification", "hq-b", { text: "permission" }),
  row(7, 700, "teammate_idle", "hq-b"),
];
const roles: Record<string, string> = { "hq-a": "fullstack", "hq-b": "reviewer" };
const roleOf = (s: string) => roles[s];

describe("buildTeamThread", () => {
  it("orders chronologically and maps kinds, dropping kinds it no longer shows (old task / teammate_idle rows)", () => {
    const t = buildTeamThread(ROWS, { roleOf });
    expect(t.map((x) => x.kind)).toEqual(["owner", "reply", "handoff", "needs_you"]);
    expect(t[0]).toMatchObject({ from: "owner", to: "hq-a", session: "hq-a" });
    expect(t[1]).toMatchObject({ from: "hq-a", to: "owner" });
  });

  it("maps session_message to a handoff A -> B with the excerpt", () => {
    const h = buildTeamThread(ROWS).find((x) => x.kind === "handoff")!;
    expect(h).toMatchObject({ from: "hq-a", to: "hq-b", text: "please review", session: "hq-a" });
  });

  it("filters by session / role", () => {
    expect(buildTeamThread(ROWS, { session: "hq-b" }).map((x) => x.kind)).toEqual(["handoff", "needs_you"]);
    expect(buildTeamThread(ROWS, { role: "fullstack", roleOf }).map((x) => x.kind)).toEqual(["owner", "reply", "handoff"]);
  });

  it("collapses consecutive noise and identical repeats, not different texts", () => {
    const rows = [
      row(1, 1, "session_start", "hq-a"), row(2, 2, "session_start", "hq-a"),
      row(3, 3, "session_reply", "hq-a", { text: "x" }), row(4, 4, "session_reply", "hq-a", { text: "x" }),
      row(5, 5, "session_reply", "hq-a", { text: "y" }),
    ];
    const t = buildTeamThread(rows);
    expect(t.map((x) => [x.kind, x.count])).toEqual([["session_start", 2], ["reply", 2], ["reply", 1]]);
  });

  it("needs-you is open until the owner writes to that session", () => {
    const rows = [row(1, 1, "notification", "hq-a", { text: "ok?" }), row(2, 2, "owner_message", "hq-a", { to_: "hq-a", text: "yes" }), row(3, 3, "notification", "hq-b")];
    const t = buildTeamThread(rows).filter((x) => x.kind === "needs_you");
    expect(t.map((x) => x.open)).toEqual([false, true]);
  });
});

describe("handoff answered by name", () => {
  it("a handoff addressed as `name [ref]` is answered by a reply whose from_name is that name", () => {
    const core = "a2830544-0719-4d6f-aaa3-644783ddb0b3";
    const team = "6de1efc8-68cb-45aa-9999-000000000001";
    const rows: ThreadRow[] = [
      // SendMessage(to: "core [ff2607]") that the journal could not resolve: to_ stays the typed text.
      row(1, 100, "session_message", team, { from_: team, to_: "core [ff2607]", text: "audit xong?", from_name: "team", to_name: null }),
      row(2, 200, "session_message", core, { from_: core, to_: team, text: "ack", from_name: "core", to_name: "team" }),
      row(3, 300, "session_message", team, { from_: team, to_: "web [c3b426]", text: "board sync", from_name: "team", to_name: null }),
    ];
    const t = buildTeamThread(rows).filter((x) => x.kind === "handoff");
    expect(t.map((x) => x.answered)).toEqual([true, false, false]);
    // Two sessions named "core": a resolved handoff is answered only by the one it went to.
    const core2 = "c2830544-0719-4d6f-aaa3-644783ddb0b3";
    const twins: ThreadRow[] = [
      row(1, 100, "session_message", team, { from_: team, to_: core, text: "ping", from_name: "team", to_name: "core" }),
      row(2, 200, "session_message", core2, { from_: core2, to_: team, text: "pong?", from_name: "core", to_name: "team" }),
      row(3, 300, "session_message", core, { from_: core, to_: team, text: "pong", from_name: "core", to_name: "team" }),
    ];
    const u = buildTeamThread(twins.slice(0, 2)).filter((x) => x.kind === "handoff");
    expect(u[0].answered).toBe(false);
    expect(buildTeamThread(twins).filter((x) => x.kind === "handoff")[0].answered).toBe(true);
    expect(partyKey("Core [FF2607]")).toBe("core");
    expect(partyKey("core")).toBe("core");
    expect(partyKey(null)).toBe("");
  });
});

describe("masked senders", () => {
  it("a handoff stored with from_ '***' falls back to the row's session", () => {
    const [h] = buildTeamThread([row(1, 1, "session_message", "a2830544-0719-4d6f-aaa3-644783ddb0b3", { from_: "***", to_: "rd", text: "hi" })]);
    expect(h).toMatchObject({ kind: "handoff", from: "a2830544-0719-4d6f-aaa3-644783ddb0b3", to: "rd" });
  });

  it("marks a handoff answered once the recipient writes back, and shows session names", () => {
    const a = "a2830544-0719-4d6f-aaa3-644783ddb0b3";
    const b = "6de1efc8-68cb-45aa-9999-000000000001";
    const rows: ThreadRow[] = [
      row(1, 100, "session_message", a, { from_: a, to_: b, text: "giúp T6?", from_name: "core", to_name: "rd" }),
      row(2, 200, "session_message", a, { from_: a, to_: b, text: "còn PR #31", from_name: "core", to_name: "rd" }),
      row(3, 300, "session_message", b, { from_: b, to_: a, text: "ok", from_name: "rd", to_name: "core" }),
    ];
    const t = buildTeamThread(rows).filter((x) => x.kind === "handoff");
    expect(t.map((x) => [x.fromName, x.toName, x.answered])).toEqual([
      ["core", "rd", true],
      ["core", "rd", true],
      ["rd", "core", false],
    ]);
  });
});
