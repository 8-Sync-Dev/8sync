import { describe, expect, it } from "vitest";
import { parseBoard, type Board } from "@/lib/lanes";
import {
  IDLE_FLAG_MS,
  agoShort,
  agoVi,
  cardMoves,
  claimMatches,
  deskClip,
  heldCard,
  roomNow,
  roomRole,
  roster,
  rosterSummary,
  stateChanges,
  type NowRoom,
} from "@/lib/now";

const NOW = 1_800_000_000_000;
const S = NOW / 1000;

/** `auto board --json` (schema 1, seconds) as crates/cli/src/verbs/ccc/target.rs prints it. */
function board(lanes: Record<string, unknown[]>, closed: unknown[] = []): Board {
  const b = parseBoard({ schema: 1, lanes: Object.entries(lanes).map(([lane, cards]) => ({ lane, cards })), closed });
  if (!b) throw new Error("bad fixture");
  return b;
}

const BOARD = board({
  backlog: [{ id: 14, text: "Export CSV", claim: { room: "lead", at: S - 40 }, notes: [{ room: "lead", text: "viết AC", at: S - 40 }] }],
  building: [{ id: 12, text: "Magic link", check: "pnpm test login", claim: { room: "dev", at: S - 600 }, notes: [{ room: "dev", text: "3/5 xanh", at: S - 45 }] }],
  blocked: [{ id: 13, text: "Migration", check: "pnpm vitest", claim: { room: "dev2", at: S - 1500 } }],
  review: [{ id: 10, text: "Gộp polling", check: "x", claim: { room: "review", at: S - 3 * 3600 } }],
  qa: [{ id: 11, text: "Timezone", check: "y" }],
});
const ROOT = "C:/work/proj";
const BOARDS = [{ root: ROOT, board: BOARD }];

const room = (o: Partial<NowRoom> & { label: string }): NowRoom => ({
  status: "idle",
  waiting: null,
  name: o.label,
  cwd: `${ROOT}/sub`,
  role: null,
  model: null,
  doing: null,
  last_active: null,
  ...o,
});

describe("roomRole", () => {
  it("mirrors room.rs: first matching token, trailing digits dropped, ≥4-char keys as prefix", () => {
    expect(roomRole("lead")?.role).toBe("plan");
    expect(roomRole("dev2")).toMatchObject({ role: "fullstack", seat: "dev", lane: "ready" });
    expect(roomRole("qa-su-code")).toMatchObject({ role: "tester", lane: "qa" });
    expect(roomRole("reviewer")?.lane).toBe("review");
    expect(roomRole("research-x")?.role).toBe("rd");
    expect(roomRole("rd")?.lane).toBeNull();
    expect(roomRole("zus")).toBeNull();
    expect(roomRole(null)).toBeNull();
  });
});

describe("claimMatches", () => {
  it("matches the registry name or the `<name>-<repo>` title auto up gives a clashing room", () => {
    expect(claimMatches("dev", "dev")).toBe(true);
    expect(claimMatches("dev", "DEV-su-code")).toBe(true);
    expect(claimMatches("dev", "dev2")).toBe(false);
    expect(claimMatches("dev", null, "hq-dev")).toBe(false);
    expect(claimMatches("", "dev")).toBe(false);
  });
});

describe("heldCard", () => {
  it("finds the room's newest claim, preferring the board whose root holds the room's cwd", () => {
    expect(heldCard({ label: "dev", name: "x", cwd: `${ROOT}/a` }, BOARDS)?.id).toBe(12);
    expect(heldCard({ label: "qa", name: "x", cwd: ROOT }, BOARDS)).toBeNull();
    const other = board({ ready: [{ id: 99, text: "other repo", check: "z", claim: { room: "dev", at: S } }] });
    const both = [{ root: "C:/elsewhere", board: other }, ...BOARDS];
    expect(heldCard({ label: "dev", name: "x", cwd: "c:\\work\\proj\\sub" }, both)?.id).toBe(12);
    // no board contains the cwd: any board's claim counts
    expect(heldCard({ label: "dev", name: "x", cwd: "D:/tmp" }, both)?.id).toBe(99);
  });
});

describe("roomNow", () => {
  it("needs the owner first, whatever else is true", () => {
    expect(roomNow(room({ label: "dev2", status: "needs_input" }), BOARDS, NOW).state).toBe("needs");
    expect(roomNow(room({ label: "qa", waiting: "Trust this folder?" }), BOARDS, NOW).state).toBe("needs");
  });

  it("is blocked when its card sits in Blocked or its claim went stale (2 h)", () => {
    expect(roomNow(room({ label: "dev2", status: "running" }), BOARDS, NOW).state).toBe("blocked");
    expect(roomNow(room({ label: "review", status: "running" }), BOARDS, NOW).state).toBe("blocked");
  });

  it("working / holding / waiting / idle from the session status and the claim", () => {
    expect(roomNow(room({ label: "dev", status: "running" }), BOARDS, NOW).state).toBe("working");
    expect(roomNow(room({ label: "dev" }), BOARDS, NOW).state).toBe("holding");
    expect(roomNow(room({ label: "qa" }), BOARDS, NOW).state).toBe("waiting");
    expect(roomNow(room({ label: "zus" }), BOARDS, NOW).state).toBe("idle");
  });

  it("last = the newer of the card note and the `8sync ls` line", () => {
    const fresh = roomNow(room({ label: "dev", doing: "Bash: pnpm test", last_active: NOW - 5_000 }), BOARDS, NOW);
    expect(fresh.last).toEqual({ text: "Bash: pnpm test", at: NOW - 5_000 });
    const old = roomNow(room({ label: "dev", doing: "Read", last_active: NOW - 600_000 }), BOARDS, NOW);
    expect(old.last).toEqual({ text: "dev: 3/5 xanh", at: (S - 45) * 1000 });
    expect(roomNow(room({ label: "qa" }), BOARDS, NOW).last).toBeNull();
  });

  it("flags only a room with nothing to do that has been quiet past a minute", () => {
    const q = (label: string, ms: number, status: NowRoom["status"] = "idle") => roomNow(room({ label, status, last_active: NOW - ms }), BOARDS, NOW);
    expect(q("qa", IDLE_FLAG_MS + 1)).toMatchObject({ flagged: true, quietMs: IDLE_FLAG_MS + 1 });
    expect(q("qa", 30_000).flagged).toBe(false);
    expect(q("zus", 5 * 60_000).flagged).toBe(true);
    expect(q("dev", 5 * 60_000).flagged).toBe(false); // holding a card between ticks is normal
    expect(q("dev", 5 * 60_000, "running")).toMatchObject({ flagged: false, quietMs: null });
    expect(roomNow(room({ label: "qa" }), BOARDS, NOW).quietMs).toBeNull(); // unknown, never guessed
  });
});

describe("roster", () => {
  it("sorts by attention, drops ended rooms, and summarises in words", () => {
    const rooms = [
      { ...room({ label: "qa", last_active: NOW - 120_000 }), key: "qa" },
      { ...room({ label: "dev", status: "running" }), key: "dev" },
      { ...room({ label: "zus", last_active: NOW - 1000 }), key: "zus" },
      { ...room({ label: "review", status: "needs_input" }), key: "review" },
      { ...room({ label: "dev2" }), key: "dev2" },
      { ...room({ label: "old", status: "ended" }), key: "old" },
    ];
    const r = roster(rooms, BOARDS, NOW);
    expect(r.map((x) => x.key)).toEqual(["review", "dev2", "dev", "qa", "zus"]);
    expect(rosterSummary(r)).toBe("1 chờ anh · 1 kẹt · 1 đang làm · 1 chờ card · 1 rảnh");
  });
});

describe("cardMoves", () => {
  it("reports lane changes and closes with the room that held the card; new cards are not moves", () => {
    const next = board(
      {
        qa: [{ id: 12, text: "Magic link", check: "pnpm test login" }],
        ready: [{ id: 50, text: "new", check: "c" }],
        blocked: [{ id: 13, text: "Migration", check: "pnpm vitest", claim: { room: "dev2", at: S - 1500 } }],
        review: [{ id: 11, text: "Timezone", check: "y" }],
      },
      [{ id: 14, text: "Export CSV", state: "dropped", by: "lead", closed: S }],
    );
    const m = cardMoves(BOARD, next);
    expect(Object.fromEntries(m)).toEqual({
      12: { from: "building", to: "qa", by: "dev" },
      11: { from: "qa", to: "review", by: null },
      14: { from: "backlog", to: "dropped", by: "lead" },
    });
    expect(cardMoves(null, next).size).toBe(0);
    expect(cardMoves(BOARD, BOARD).size).toBe(0);
  });
});

describe("stateChanges", () => {
  it("only keys present before and after with a different value", () => {
    expect(stateChanges(null, { a: "working" }).size).toBe(0);
    expect([...stateChanges({ a: "working", b: "idle" }, { a: "waiting", b: "idle", c: "needs" })]).toEqual(["a"]);
  });
});

describe("deskClip", () => {
  it("the desk pose is the room's real state; a cheer only after a card moved on", () => {
    expect(deskClip({ state: "working" }, "running")).toBe("running");
    expect(deskClip({ state: "working" }, "idle")).toBe("typing");
    expect(deskClip({ state: "needs" }, "typing")).toBe("waiting");
    expect(deskClip({ state: "blocked" }, "typing")).toBe("stalled");
    expect(deskClip({ state: "waiting" }, null)).toBe("idle");
    expect(deskClip({ state: "holding" }, null, { cheer: true })).toBe("done");
    expect(deskClip({ state: "working" }, null, { inMeeting: true, cheer: true })).toBe("away");
  });
});

describe("agoVi / agoShort", () => {
  it("formats relative time in Vietnamese and stays empty for an unknown time", () => {
    expect(agoVi(NOW - 3_000, NOW)).toBe("vừa xong");
    expect(agoVi(NOW - 45_000, NOW)).toBe("45 giây trước");
    expect(agoVi(NOW - 4 * 60_000, NOW)).toBe("4 phút trước");
    expect(agoVi(NOW - 3 * 3600_000, NOW)).toBe("3 giờ trước");
    expect(agoVi(null, NOW)).toBe("");
    expect(agoShort(NOW - 41_000, NOW)).toBe("41s");
    expect(agoShort(NOW - 5 * 60_000, NOW)).toBe("5 ph");
    expect(agoShort(0, NOW)).toBe("");
  });
});
