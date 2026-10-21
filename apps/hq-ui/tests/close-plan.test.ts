import { describe, expect, it } from "vitest";
import { closeDoneText, closeLines, closeTotal, ownWarning, parseClosePlan, type ClosePlan } from "@/lib/close-plan";

const item = (label: string, own = false) => ({ label, pid: 7, kind: "process" as const, own });

const plan = (over: Partial<ClosePlan> = {}): ClosePlan => ({
  root: "C:\\w\\game",
  dry_run: true,
  rooms: [item("lead"), item("dev")],
  claude: [],
  omp: [item("omp-lead"), item("core", true)],
  procs: [item("vite preview :4120"), item("node tsserver.js"), item("python3 serve.py")],
  skipped: [],
  counts: { rooms: 2, claude: 0, omp: 2, procs: 3 },
  auto: null,
  ok: true,
  ...over,
});

describe("Đóng dự án dialog", () => {
  it("lists every kind with its count, zero included, names cut after a few", () => {
    expect(closeLines(plan())).toEqual([
      { key: "rooms", label: "Phòng team", n: 2, detail: "lead, dev" },
      { key: "claude", label: "Session Claude Code khác", n: 0, detail: "" },
      { key: "omp", label: "Phiên omp", n: 2, detail: "omp-lead, core" },
      { key: "procs", label: "Tiến trình sót", n: 3, detail: "vite preview :4120, node tsserver.js +1" },
    ]);
    expect(closeTotal(plan())).toBe(7);
  });

  it("warns when an omp session that is no team room would close (the owner's own terminal)", () => {
    expect(ownWarning(plan())).toBe("Phiên omp “core” có thể là terminal anh đang mở: nó sẽ bị đóng giữa chừng (hội thoại vẫn giữ).");
    expect(ownWarning(plan({ omp: [item("core", true), item("web", true)] }))).toContain("2 phiên omp (core, web)");
    expect(ownWarning(plan({ omp: [item("omp-lead")] }))).toBeNull();
  });

  it("says what stopped after the close, or that nothing ran", () => {
    expect(closeDoneText("game", plan())).toBe("Đã đóng game: dừng 2 phòng team, 2 phiên omp, 3 tiến trình sót. Tự hiện lại khi có hoạt động mới.");
    const none = plan({ rooms: [], omp: [], procs: [], counts: { rooms: 0, claude: 0, omp: 0, procs: 0 } });
    expect(closeDoneText("game", none)).toBe("Đã đóng game: không còn gì chạy. Tự hiện lại khi có hoạt động mới.");
  });

  it("reads the --json line and refuses anything else", () => {
    expect(parseClosePlan(`warning: x\n${JSON.stringify(plan())}\n`)?.counts.procs).toBe(3);
    expect(parseClosePlan("Đóng dự án C:\\w\\game — chạy thử")).toBeNull();
    expect(parseClosePlan('{"root": 1}')).toBeNull();
    expect(parseClosePlan("{not json")).toBeNull();
  });
});
