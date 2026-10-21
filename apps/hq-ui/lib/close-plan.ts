// "Đóng dự án" stops the project for real: `8sync ccc auto close` (crates/cli/src/verbs/ccc/close.rs).
// Its `--json` answer (the dry run for the confirm dialog, the result after) and the dialog's text.

export type CloseItem = { label: string; pid: number; kind: "background" | "process"; own: boolean; ok?: boolean };

export type ClosePlan = {
  root: string;
  dry_run: boolean;
  /** Team rooms, as `auto down` stops them. */
  rooms: CloseItem[];
  /** Other Claude Code sessions in the repo or its worktrees. */
  claude: CloseItem[];
  /** omp sessions, team omp rooms included; `own`: no team room, most likely the owner's own terminal. */
  omp: CloseItem[];
  /** Leftover node / python / uv / browser processes of the project. */
  procs: CloseItem[];
  skipped: { label: string; why: string }[];
  counts: { rooms: number; claude: number; omp: number; procs: number };
  auto: "left" | "untouched" | null;
  ok: boolean;
};

const KINDS = ["rooms", "claude", "omp", "procs"] as const;

/** The `--json` line of `8sync ccc auto close`, or null when stdout is not one (an older 8sync). */
export function parseClosePlan(stdout: string): ClosePlan | null {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith("{"));
  if (!line) return null;
  try {
    const v = JSON.parse(line) as Partial<ClosePlan>;
    if (typeof v.root !== "string" || typeof v.dry_run !== "boolean" || !v.counts || KINDS.some((k) => !Array.isArray(v[k]))) return null;
    return { skipped: [], auto: null, ok: true, ...v } as ClosePlan;
  } catch {
    return null;
  }
}

export type CloseLine = { key: (typeof KINDS)[number]; label: string; n: number; detail: string };

/** At most `max` names, then "+N". */
function names(items: CloseItem[], max = 3): string {
  const shown = items.slice(0, max).map((i) => i.label);
  return items.length > max ? `${shown.join(", ")} +${items.length - max}` : shown.join(", ");
}

/** One line per kind the dialog lists, zero counts included (the owner sees nothing was missed). */
export function closeLines(p: ClosePlan): CloseLine[] {
  return [
    { key: "rooms", label: "Phòng team", n: p.counts.rooms, detail: names(p.rooms) },
    { key: "claude", label: "Session Claude Code khác", n: p.counts.claude, detail: names(p.claude) },
    { key: "omp", label: "Phiên omp", n: p.counts.omp, detail: names(p.omp) },
    { key: "procs", label: "Tiến trình sót", n: p.counts.procs, detail: names(p.procs, 2) },
  ];
}

/** An omp session that is no team room is most likely a terminal the owner has open right now. */
export function ownWarning(p: ClosePlan): string | null {
  const own = p.omp.filter((o) => o.own);
  if (own.length === 0) return null;
  const which = own.map((o) => o.label).join(", ");
  return own.length === 1
    ? `Phiên omp “${which}” có thể là terminal anh đang mở: nó sẽ bị đóng giữa chừng (hội thoại vẫn giữ).`
    : `${own.length} phiên omp (${which}) có thể là terminal anh đang mở: sẽ bị đóng giữa chừng (hội thoại vẫn giữ).`;
}

export function closeTotal(p: ClosePlan): number {
  return p.counts.rooms + p.counts.claude + p.counts.omp + p.counts.procs;
}

/** The toast after a close: what stopped, then that it comes back on new activity. */
export function closeDoneText(name: string, p: ClosePlan | null): string {
  const parts = p
    ? closeLines(p)
        .filter((l) => l.n > 0)
        .map((l) => `${l.n} ${l.label.toLowerCase()}`)
    : [];
  return `Đã đóng ${name}: ${parts.length ? `dừng ${parts.join(", ")}` : "không còn gì chạy"}. Tự hiện lại khi có hoạt động mới.`;
}
