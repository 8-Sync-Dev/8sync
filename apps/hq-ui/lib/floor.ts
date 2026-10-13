// Pure derivation of a floor desk's state from `8sync ls --json` + hq session data.
import type { SpriteState } from "./sprite/frames";

export type FloorState = SpriteState;

export type LsInput = {
  status?: string | null; // running | active | idle
  last_tool?: string | null;
  last_activity?: string | null; // "Name: what"
  doing?: string | null;
  tasks_done?: number | null;
  tasks_total?: number | null;
  current_task?: string | null;
  last_active?: number | null; // unix seconds
  stalled_error?: string | boolean | null;
};

export type HqInput = {
  status?: string | null; // needs_input | running | idle | ended
  detail?: string | null; // waitingFor
} | null;

export type Derived = {
  state: FloorState;
  label: string;
  caption: string;
  progress: string | null;
};

export const STALL_SECS = 5 * 60;
export const OLD_IDLE_SECS = 24 * 3600;

const EDIT = new Set(["edit", "write", "multiedit", "notebookedit"]);
const RUN = new Set(["bash", "powershell", "monitor"]);
const READ = new Set(["read", "grep", "glob", "webfetch", "websearch", "lsp"]);

export function toolOf(ls: Pick<LsInput, "last_tool" | "last_activity">): string | null {
  const t = ls.last_tool?.trim();
  if (t) return t.toLowerCase();
  const a = ls.last_activity;
  const i = a ? a.indexOf(":") : -1;
  return i > 0 ? a!.slice(0, i).trim().toLowerCase() : null;
}

const oneLine = (s: string, max = 120) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export const LABEL: Record<FloorState, string> = {
  idle: "nghỉ",
  typing: "đang gõ code",
  running: "chạy lệnh",
  reading: "đọc/tìm",
  waiting: "chờ anh",
  stalled: "kẹt",
  done: "xong",
};

export function deriveFloor(ls: LsInput | null, hq: HqInput, nowMs = Date.now()): Derived {
  const status = ls?.status ?? (hq?.status === "running" ? "running" : "idle");
  const total = ls?.tasks_total ?? 0;
  const doneN = ls?.tasks_done ?? 0;
  const progress = total > 0 ? `${doneN}/${total}` : null;
  const ageSecs = ls?.last_active ? nowMs / 1000 - ls.last_active : null;
  const live = status === "active" || (status === "running" && hq?.status !== "idle");
  const text = oneLine(ls?.doing || ls?.last_activity || "");
  const make = (state: FloorState, caption: string, label = LABEL[state]): Derived => ({
    state,
    label,
    caption: oneLine(caption),
    progress,
  });

  if (hq?.status === "needs_input") return make("waiting", hq.detail || "Claude đang chờ anh trả lời");

  if (ls?.stalled_error) {
    return make("stalled", typeof ls.stalled_error === "string" ? ls.stalled_error : "Lỗi API, cần xem lại");
  }
  // A live process whose transcript has not moved for 5 min is only "stuck" while
  // it still has open work; a session parked at its prompt (no open task, or hq
  // says idle) is resting.
  const quiet = status === "running" && ageSecs !== null && ageSecs > STALL_SECS;
  const openWork = Boolean(ls?.current_task) || (total > 0 && doneN < total);
  if (quiet && openWork && hq?.status !== "idle") {
    return make("stalled", `Không tiến triển ${Math.floor(ageSecs / 60)} phút${text ? `: ${text}` : ""}`);
  }
  if (quiet) return make("idle", "Đang chờ prompt mới");
  if (total > 0 && doneN >= total && status !== "running") return make("done", text || `Xong ${progress}`);

  if (live) {
    const tool = toolOf(ls ?? {});
    if (tool && EDIT.has(tool)) return make("typing", text);
    if (tool && RUN.has(tool)) return make("running", text);
    if (tool && READ.has(tool)) return make("reading", text);
    return make("typing", text, "đang làm");
  }
  return make("idle", text || "Đang nghỉ");
}

/** Display order: waiting, stalled, working, done, idle. */
export const GROUP_ORDER: Record<FloorState, number> = {
  waiting: 0,
  stalled: 1,
  typing: 2,
  running: 2,
  reading: 2,
  done: 3,
  idle: 4,
};

export type FloorRow = Derived & {
  id: string;
  /** Session name used for selection (hq name when known). */
  name: string;
  title: string;
  last_active: number | null;
  hq: boolean;
};

export function sortFloor(rows: FloorRow[]): FloorRow[] {
  return [...rows].sort(
    (a, b) => GROUP_ORDER[a.state] - GROUP_ORDER[b.state] || (b.last_active ?? 0) - (a.last_active ?? 0),
  );
}

export const isOldIdle = (r: FloorRow, nowMs = Date.now()) =>
  r.state === "idle" && r.last_active != null && nowMs / 1000 - r.last_active > OLD_IDLE_SECS;
