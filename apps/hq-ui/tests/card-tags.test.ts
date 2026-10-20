import { describe, expect, it } from "vitest";
import { cardParts, nextUp, parentOf, prRef, splitInto } from "@/lib/card-tags";
import { parseBoard, type Card } from "@/lib/lanes";

const NOW = Date.parse("2026-10-17T16:00:00Z");
const card = (over: Partial<Card>): Card => ({
  id: 1,
  text: "x",
  lane: "ready",
  check: null,
  label: null,
  claim: null,
  pr: null,
  sha: null,
  bounces: 0,
  note: null,
  added: 0,
  ...over,
});

describe("cardParts", () => {
  it("splits epic, role and other tags off the title (the ai-game-studio card)", () => {
    const p = cardParts("[#1 v1][art-director] Art bible 2.5D góc 3/4 (kích thước sprite 64px)");
    expect(p.title).toBe("Art bible 2.5D góc 3/4 (kích thước sprite 64px)");
    expect(p.tags.map((t) => [t.text, t.kind])).toEqual([
      ["#1 v1", "epic"],
      ["art-director", "role"],
    ]);
  });
  it("gives known room roles their role id; unknown words stay plain tags", () => {
    const p = cardParts("[core] [rd][qa][v2][mobile] Ship login");
    expect(p.tags.map((t) => [t.text, t.kind, t.role])).toEqual([
      ["core", "role", "fullstack"],
      ["rd", "role", "rd"],
      ["qa", "role", "tester"],
      ["v2", "epic", null],
      ["mobile", "tag", null],
    ]);
    expect(p.title).toBe("Ship login");
  });
  it("leaves a text without leading tags (or only tags) whole", () => {
    expect(cardParts("Fix [bug] in the middle")).toEqual({ title: "Fix [bug] in the middle", tags: [] });
    expect(cardParts("[core]").title).toBe("[core]");
  });
});

describe("nextUp / prRef / from", () => {
  it("is the first unclaimed, non-qa card of Ready in queue order", () => {
    expect(nextUp([card({ id: 4, claim: { room: "dev", at: NOW } }), card({ id: 5, label: "qa" }), card({ id: 6 }), card({ id: 7 })])).toBe(6);
    expect(nextUp([])).toBeNull();
  });
  it("takes the most urgent card first, as `auto claim` does (unset = P2, queue order within a priority)", () => {
    expect(nextUp([card({ id: 1, prio: 3 }), card({ id: 2 }), card({ id: 3, prio: 0, claim: { room: "dev", at: NOW } }), card({ id: 4, prio: 1 }), card({ id: 5, prio: 1 })])).toBe(4);
    expect(nextUp([card({ id: 1, prio: 3 }), card({ id: 2, prio: 2 }), card({ id: 3 })])).toBe(2);
  });
  it("reads prio 0..3 and drops anything else", () => {
    const b = parseBoard({ schema: 1, lanes: [{ lane: "ready", cards: [0, 3, 4, -1, 1.5, "P1", null].map((prio, i) => ({ id: i + 1, text: "t", prio })) }] })!;
    expect(b.lanes.ready.map((c) => c.prio)).toEqual([0, 3, null, null, null, null, null]);
  });
  it("prints a PR number and links only a real pull URL", () => {
    expect(prRef("#81")).toEqual({ text: "#81", href: null });
    expect(prRef("81")).toEqual({ text: "#81", href: null });
    expect(prRef("https://github.com/8-Sync-Dev/su-code/pull/84")).toEqual({ text: "#84", href: "https://github.com/8-Sync-Dev/su-code/pull/84" });
    // a room writes the card: a look-alike host is shown as text, never a link
    expect(prRef("https://evil.example/o/r/pull/84").href).toBeNull();
    expect(prRef("http://github.com/o/r/pull/84").href).toBeNull();
  });
  it("reads who queued the card (null = the owner)", () => {
    const b = parseBoard({ schema: 1, lanes: [{ lane: "ready", cards: [{ id: 1, text: "a", from: "lead" }, { id: 2, text: "b" }] }] })!;
    expect(b.lanes.ready.map((c) => c.from)).toEqual(["lead", null]);
  });
});

describe("parentOf / splitInto", () => {
  it("reads the idea a card was split off, as target.rs `parent` does (3d-game #10)", () => {
    const of = (text: string) => parentOf({ id: 7, text });
    expect(["[#10] player", "[ui][#1 v2] hud", "[#125][ui] art"].map(of)).toEqual([10, 1, 125]);
    expect(["[dev] fix #5", "x #5", "[#7] itself"].map(of)).toEqual([null, null, null]);
    const b = parseBoard({
      schema: 1,
      lanes: [
        { lane: "backlog", cards: [{ id: 10, text: "realistic 4K" }] },
        { lane: "building", cards: [{ id: 17, text: "[#10] player" }] },
        { lane: "qa", cards: [{ id: 14, text: "[#10] CSM" }] },
      ],
    })!;
    expect(splitInto(b.lanes).get(10)).toEqual([17, 14]);
  });
});

describe("board UI markup", () => {
  it("card: chips, clamped title, claim, PR, warn bounces, missing check", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { CardItem } = await import("@/components/hq/lanes-view");
    const c = card({ id: 6, lane: "building", text: "[#1 v1][art-director] Art bible", label: "feature", claim: { room: "dev", at: NOW - 300_000 }, pr: "#12", bounces: 4 });
    const html = renderToStaticMarkup(createElement(CardItem, { c, now: NOW, next: false, onOpen: () => {} }));
    for (const s of ["#1 v1", "art-director", "feature", "line-clamp-3", "Art bible", "dev", "5 ph", "#12", "4", "lần bị trả về", "thiếu lệnh check", 'aria-haspopup="dialog"']) expect(html).toContain(s);
    expect(html).toContain("font-semibold text-[color-mix(in_oklch,var(--st-needs),black_38%)]");
    const calm = renderToStaticMarkup(createElement(CardItem, { c: card({ id: 7, check: "pnpm test", bounces: 1 }), now: NOW, next: true, onOpen: () => {} }));
    expect(calm).toContain("Kế tiếp");
    expect(calm).not.toContain("thiếu lệnh check");
    expect(calm).not.toContain("var(--st-needs)");
  });

  it("sheet detail: full text, lane, copyable check, note, claim, PR link, sha, bounces, added", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { CardDetail } = await import("@/components/hq/card-sheet");
    const c = card({
      id: 9,
      lane: "approved",
      text: "[#2 v1][core] Merge login",
      label: "bug",
      check: "pnpm e2e login",
      claim: { room: "review", at: NOW - 3 * 3600_000 },
      pr: "https://github.com/o/r/pull/81",
      sha: "0123abcdef4567",
      bounces: 2,
      note: { room: "qa", text: "UAT ok 390px", at: NOW - 120_000 },
      added: NOW - 2 * 86_400_000,
      from: "lead",
    });
    const html = renderToStaticMarkup(createElement(CardDetail, { c, now: NOW, next: false }));
    for (const s of ["Toàn văn", "[#2 v1][core] Merge login", "Approved", "chờ anh trả lời Ship", "bug", "pnpm e2e login", "Chép lệnh check", "review", "im quá 2 giờ", "UAT ok 390px", "2 phút trước", 'href="https://github.com/o/r/pull/81"', "#81", "0123abcdef45", "2 lần", "2 ngày trước", "bởi phòng lead"])
      expect(html).toContain(s);
    const bare = renderToStaticMarkup(createElement(CardDetail, { c: card({ id: 3, text: "plain" }), now: NOW, next: false }));
    for (const s of ["Chưa có. Card không qua QA", "Chưa phòng nào nhận.", "Chưa có ghi chú.", "Chưa lần nào", "anh giao"]) expect(bare).toContain(s);
    expect(bare).not.toContain("Toàn văn");
    expect(bare).not.toContain("Pull request");
  });
});
