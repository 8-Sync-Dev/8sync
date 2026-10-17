import { describe, expect, it } from "vitest";
import { cardPath, edges, flowRows, laneNow, moveKind } from "@/lib/flow";
import { parseBoard, parseHistory, parseMove } from "@/lib/lanes";
import { recentMoves, topCards } from "@/lib/overview";

describe("card history from notes", () => {
  it("parseMove reads the two lanes of a move note (target.rs move_to/claim text)", () => {
    expect(parseMove("ready → building")).toEqual({ from: "ready", to: "building" });
    expect(parseMove("building → qa: PR #81")).toEqual({ from: "building", to: "qa" });
    expect(parseMove("backlog → ready: AC: form validates email")).toEqual({ from: "backlog", to: "ready" });
    expect(parseMove("qa → blocked (🛡 bị trả lần 3: lead/owner xem lại card)")).toEqual({ from: "qa", to: "blocked" });
    expect(parseMove("đang viết test")).toBeNull();
    expect(parseMove("ready → done")).toBeNull();
    expect(parseMove("readyx → qa")).toBeNull();
  });

  it("parseHistory: seconds → ms, oldest first, bad notes skipped", () => {
    const h = parseHistory([
      { at: 20, room: "qa", text: "qa → ready: [qa] 390px tràn" },
      { at: 10, room: "dev", text: "ready → building" },
      { at: 15, text: "đang viết test" },
      { at: 16, room: "x" },
      null,
    ]);
    expect(h).toEqual([
      { at: 10_000, room: "dev", text: "ready → building", from: "ready", to: "building" },
      { at: 15_000, room: null, text: "đang viết test" },
      { at: 20_000, room: "qa", text: "qa → ready: [qa] 390px tràn", from: "qa", to: "ready" },
    ]);
    expect(parseHistory("x")).toEqual([]);
  });
});

const notes = [
  { at: 10, room: "lead", text: "backlog → ready: AC ok" },
  { at: 20, room: "dev", text: "ready → building" },
  { at: 25, room: "dev", text: "đang viết test" },
  { at: 30, room: "dev", text: "building → qa: PR #81" },
  { at: 40, room: "qa", text: "qa → ready: [qa] 390px tràn" },
  { at: 50, room: "dev", text: "ready → building" },
];

describe("cardPath", () => {
  it("every stop in order, the bounce marked back, plain notes on the stop they were written at", () => {
    const v = cardPath("building", parseHistory(notes), 5_000);
    expect(v.map((x) => x.lane)).toEqual(["backlog", "ready", "building", "qa", "ready", "building"]);
    expect(v.map((x) => x.kind)).toEqual([null, "fwd", "fwd", "fwd", "back", "fwd"]);
    expect(v[0].at).toBe(5_000);
    expect(v[2].notes.map((n) => n.text)).toEqual(["đang viết test"]);
    expect(v[4]).toMatchObject({ room: "qa", text: "qa → ready: [qa] 390px tràn", at: 40_000 });
    expect(edges(v).map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual(["backlog>ready:fwd", "ready>building:fwd", "building>qa:fwd", "qa>ready:back", "ready>building:fwd"]);
  });

  it("no moves: one stop in the current lane; trimmed notes fill the gap to the current lane", () => {
    expect(cardPath("ready", [], 1).map((x) => x.lane)).toEqual(["ready"]);
    expect(cardPath(null, [], 1)).toEqual([]);
    // Oldest kept note is review → approved; the card is now in blocked after an unlogged move.
    const v = cardPath("blocked", parseHistory([{ at: 1, room: "review", text: "review → approved" }]), 0);
    expect(v.map((x) => `${x.lane}:${x.kind}`)).toEqual(["review:null", "approved:fwd", "blocked:side"]);
    expect(moveKind("blocked", "ready")).toBe("side");
  });
});

describe("flowRows + laneNow", () => {
  const board = parseBoard({
    schema: 1,
    lanes: [
      { lane: "ready", cards: [{ id: 4, text: "old idle", added: 1 }] },
      { lane: "building", cards: [{ id: 2, text: "fix crash", added: 5, claim: { room: "dev", at: 60 }, notes, bounces: 1 }] },
      { lane: "qa", cards: [{ id: 3, text: "login", added: 2, claim: { room: "qa", at: 30 } }, { id: 6, text: "nav", added: 3, claim: { room: "qa", at: 31 } }] },
    ],
    closed: [
      { id: 9, text: "old", state: "done", closed: 70, lane: "approved", notes: [{ at: 65, room: "review", text: "review → approved" }] },
      { id: 8, text: "older", state: "dropped", closed: 69 },
    ],
  })!;

  it("open cards by latest activity, then closed by close time; closed keep their path and lane", () => {
    const rows = flowRows(board);
    expect(rows.map((r) => `${r.id}:${r.state}`)).toEqual(["2:open", "6:open", "3:open", "4:open", "9:done", "8:dropped"]);
    expect(rows[0]).toMatchObject({ lane: "building", room: "dev", bounces: 1, at: 60_000 });
    expect(rows[4]).toMatchObject({ lane: "approved", room: null, card: null });
    expect(rows[4].visits.map((v) => v.lane)).toEqual(["review", "approved"]);
    expect(rows[5].visits).toEqual([]);
  });

  it("per lane: count and the rooms holding cards there, once each", () => {
    const n = laneNow(board);
    expect(n.qa).toEqual({ n: 2, rooms: ["qa"] });
    expect(n.building).toEqual({ n: 1, rooms: ["dev"] });
    expect(n.ready).toEqual({ n: 1, rooms: [] });
    expect(n.blocked).toEqual({ n: 0, rooms: [] });
  });
});

describe("overview summaries", () => {
  const board = parseBoard({
    schema: 1,
    lanes: [
      { lane: "ready", cards: [{ id: 4, text: "a", added: 1 }, { id: 5, text: "b", added: 2, prio: 0 }, { id: 7, text: "c", added: 3 }] },
      { lane: "qa", cards: [{ id: 3, text: "login", added: 2, notes: [{ at: 30, room: "dev", text: "building → qa: PR #9" }, { at: 31, room: "qa", text: "chạy check" }] }] },
    ],
    closed: [{ id: 9, text: "old", state: "done", closed: 40, lane: "approved", by: "lead" }],
  })!;

  it("topCards: busy lanes only, count and the first cards in claim order (P0 first)", () => {
    expect(topCards(board, 2).map((g) => [g.lane, g.n, g.cards.map((c) => c.id)])).toEqual([
      ["ready", 3, [5, 4]],
      ["qa", 1, [3]],
    ]);
  });

  it("recentMoves: the latest lane change per card, a close counts as a move to done", () => {
    expect(recentMoves(board)).toEqual([
      { id: 9, text: "old", from: "approved", to: "done", room: "lead", at: 40_000 },
      { id: 3, text: "login", from: "building", to: "qa", room: "dev", at: 30_000 },
    ]);
  });
});
