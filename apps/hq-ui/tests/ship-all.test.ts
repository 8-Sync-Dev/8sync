import { describe, expect, it } from "vitest";
import type { Ask } from "@/lib/ask";
import { shipAskOf, shipQuestion } from "@/lib/ship-all";

const ship = (labels: string[], header = "Ship", multi = false): Ask => ({
  kind: "question",
  at: 1,
  questions: [{ header, question: "Merge 21 card?", multi, options: labels.map((label) => ({ label, description: null })) }],
});
const room = (sid: string | null, root: string, ask: Ask | null, delivery: "terminal" | "inbox" | null = "inbox") => ({ session_id: sid, delivery, project: { root }, ask });

describe("Ship tất cả on the Approved column (owner 2026-10-22: 21 approved cards sat behind an unanswered Ship question)", () => {
  it("finds the project's pending Ship question and the option that approves everything", () => {
    const rooms = [
      room("other", "C:/x/other", ship(["Duyệt tất cả (Recommended)", "Dừng"])),
      room("lead", "C:/x/app", ship(["Chỉ merge, chưa deploy", "Duyệt tất cả (Recommended)", "Dừng"])),
    ];
    expect(shipAskOf(rooms, "C:/x/app")).toEqual({ sid: "lead", label: "Duyệt tất cả (Recommended)", key: "2" });
    expect(shipAskOf(rooms, "c:\\x\\app\\")).toEqual({ sid: "lead", label: "Duyệt tất cả (Recommended)", key: "2" });
    expect(shipAskOf(rooms, "C:/x/none")).toBeNull();
  });
  it("falls back to the recommended option, then the first; skips terminal rooms and non-Ship questions", () => {
    expect(shipAskOf([room("a", "/r", ship(["Go (Recommended)", "Stop"]))], "/r")?.key).toBe("1");
    expect(shipAskOf([room("a", "/r", ship(["Stop", "Go"]))], "/r")?.key).toBe("1");
    expect(shipAskOf([room("a", "/r", ship(["Duyệt tất cả"]), "terminal")], "/r")).toBeNull();
    expect(shipAskOf([room(null, "/r", ship(["Duyệt tất cả"]))], "/r")).toBeNull();
    expect(shipAskOf([room("a", "/r", ship(["Duyệt tất cả"], "Team"))], "/r")).toBeNull();
    expect(shipQuestion(ship(["A", "B"], "Ship", true))).toBeNull();
    expect(shipQuestion(null)).toBeNull();
  });
});
