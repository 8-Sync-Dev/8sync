// Pure derivation of a floor desk's state from `8sync ls --json` + hq session data.
import { hhmm } from "./auto";
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
  /** Unix seconds when 8sync resumes the stopped turn by itself (contract C2); null or absent = the owner must act. */
  stalled_resume_at?: number | null;
};

export type HqInput = {
  status?: string | null; // needs_input | running | idle | ended
  detail?: string | null; // waitingFor
  /** Newest `su-code/ship/<slug>/STANDUP.md` under the session's repo (`at` = mtime, unix ms). */
  standup?: { slug: string; at: number } | null;
} | null;

/** A standup written less than this long ago puts the room in a sprint meeting. */
export const MEETING_MS = 2 * 60_000;

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
  meeting: "họp sprint",
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
    const err = typeof ls.stalled_error === "string" ? ls.stalled_error : null;
    const at = ls.stalled_resume_at;
    if (typeof at === "number" && Number.isFinite(at)) {
      const when = hhmm(at * 1000);
      return make("stalled", err === "rate_limit" ? `Hết usage — tự chạy lại lúc ${when}` : `Lỗi API (${err ?? "không rõ"}) — tự thử lại lúc ${when}`, "chờ tự chạy lại");
    }
    return make("stalled", `${err ?? "Lỗi API"} — cần anh xử lý`);
  }
  // `8sync ccc standup <slug>` just wrote the board: the room is in its sprint meeting for a moment.
  if (hq?.standup && nowMs - hq.standup.at >= 0 && nowMs - hq.standup.at < MEETING_MS && status !== "idle") {
    return make("meeting", `Họp sprint ${hq.standup.slug}${text ? `: ${text}` : ""}`);
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
  meeting: 2,
  done: 3,
  idle: 4,
};

export type FloorRow = Derived & {
  /** Unique per row (engine + repo + name); names repeat across repos and engines. */
  id: string;
  /** Session name used for selection (hq name when known). */
  name: string;
  title: string;
  last_active: number | null;
  hq: boolean;
  /** `repo` from `8sync ls` ("~/startup/x"), or the hq cwd. */
  repo?: string | null;
  /** ccc | omp | feynman | forge ... */
  engine?: string | null;
  /** 8-char session id when one is known. */
  sid?: string | null;
  /** hq session that matched no `8sync ls` row; sorts after matched desks. */
  unmatched?: boolean;
  /** Context tokens from `8sync ls` (null when unknown). */
  tokens?: number | null;
  /** Where HQ queues messages for this room (`8sync ls` `inbox_id`, contract C3): Claude session id or `omp-<16 hex>`. */
  inbox_id?: string | null;
  /** A process has the session open or its transcript moved in the last 2 min (`8sync ls` status running/active). */
  live?: boolean;
};

export function sortFloor(rows: FloorRow[]): FloorRow[] {
  return [...rows].sort(
    (a, b) => GROUP_ORDER[a.state] - GROUP_ORDER[b.state] || Number(!!a.unmatched) - Number(!!b.unmatched) || (b.last_active ?? 0) - (a.last_active ?? 0),
  );
}

export const isOldIdle = (r: FloorRow, nowMs = Date.now()) =>
  r.state === "idle" && r.last_active != null && nowMs / 1000 - r.last_active > OLD_IDLE_SECS;

// ---- display helpers (pure; tested in tests/floor.test.ts) ----

// Leading emoji (with variation selectors / ZWJ joins) and an ALLCAPS tag like "TRACE:".
const LEAD_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}]|\s)+/u;
const LEAD_TAG = /^[A-Z][A-Z0-9_-]{1,15}:\s+/;

/** "🔗 TRACE: Clarify x" -> "Clarify x". Falls back to the input when nothing would remain. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A session id as people read it: the first 8 hex chars. */
export const shortId = (id: string | null | undefined): string | null => (id ? (UUID.test(id.trim()) ? id.trim().slice(0, 8) : id.trim()) : null);

export function cleanTitle(raw: string | null | undefined): string {
  const t = (raw ?? "").replace(/\s+/g, " ").trim();
  // an untitled Claude session reports its uuid as the title
  if (UUID.test(t)) return `phiên ${t.slice(0, 8)}`;
  const out = t.replace(LEAD_EMOJI, "").replace(LEAD_TAG, "").trim();
  return out || t;
}

const ENGINE: Record<string, string> = { ccc: "Claude", claude: "Claude", omp: "omp" };
export const engineLabel = (e: string | null | undefined): string | null => (e ? (ENGINE[e] ?? e) : null);

/** Last path segment: "~/startup/su-code" -> "su-code". */
export function repoName(repo: string | null | undefined): string {
  const r = repo?.trim().replace(/\/+$/, "");
  if (!r) return "Khác";
  const i = r.lastIndexOf("/");
  return i >= 0 ? r.slice(i + 1) || r : r;
}

/** Compact Vietnamese age: "vừa xong", "12 phút", "3 giờ", "2 ngày". */
export function ageLabel(lastActive: number | null | undefined, nowMs = Date.now()): string {
  if (lastActive == null) return "";
  const s = Math.max(0, nowMs / 1000 - lastActive);
  if (s < 60) return "vừa xong";
  if (s < 3600) return `${Math.floor(s / 60)} phút`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ`;
  return `${Math.floor(s / 86400)} ngày`;
}

export type DeskRow = FloorRow & {
  /** Cleaned title for display (full title stays in `title`). */
  heading: string;
  /** Name shown on the desk; identical names in one repo get the 8-char id (or #n). */
  who: string;
};

export type RepoGroup = {
  repo: string;
  name: string;
  /** waiting / stalled / working: big desks on the floor strip. */
  desks: DeskRow[];
  /** idle / done (not older than a day): compact list. */
  rest: DeskRow[];
  needs: number;
  working: number;
};

const ACTIVE = new Set<FloorState>(["waiting", "stalled", "typing", "running", "reading", "meeting"]);
const WORKING = new Set<FloorState>(["typing", "running", "reading", "meeting"]);

/** Annotate `who`: identical names inside one repo get a suffix so "core" x3 stays tellable. */
export function disambiguate(rows: FloorRow[]): DeskRow[] {
  const count = new Map<string, number>();
  const key = (r: FloorRow) => `${r.repo ?? ""}\0${r.name}`;
  for (const r of rows) count.set(key(r), (count.get(key(r)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const k = key(r);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    const dup = (count.get(k) ?? 0) > 1;
    const heading = cleanTitle(r.title) || r.name;
    const label = shortId(r.name) ?? r.name;
    return { ...r, heading, who: dup ? `${label} · ${shortId(r.sid) ?? `#${n}`}` : label };
  });
}

/**
 * Floor layout: one group per repo. Groups with someone waiting or stuck come
 * first, then groups with work in progress, then by latest activity. Idle rows
 * older than a day leave the groups and go to `old`.
 */
export function groupFloor(rows: FloorRow[], nowMs = Date.now()): { groups: RepoGroup[]; old: DeskRow[] } {
  const all = disambiguate(sortFloor(rows));
  const old: DeskRow[] = [];
  const by = new Map<string, RepoGroup>();
  for (const r of all) {
    if (isOldIdle(r, nowMs)) {
      old.push(r);
      continue;
    }
    const repo = r.repo?.trim() || "";
    let g = by.get(repo);
    if (!g) by.set(repo, (g = { repo, name: repoName(repo), desks: [], rest: [], needs: 0, working: 0 }));
    (ACTIVE.has(r.state) ? g.desks : g.rest).push(r);
    if (r.state === "waiting" || r.state === "stalled") g.needs++;
    if (WORKING.has(r.state)) g.working++;
  }
  const rank = (g: RepoGroup) => (g.needs ? 0 : g.working ? 1 : 2);
  const latest = (g: RepoGroup) => Math.max(0, ...[...g.desks, ...g.rest].map((r) => r.last_active ?? 0));
  const groups = [...by.values()].sort((a, b) => rank(a) - rank(b) || latest(b) - latest(a));
  return { groups, old };
}

// ---- handoff bubbles (AC5) ----

/** How long a "→ B" / "← A" bubble stays on a desk. */
export const HANDOFF_MS = 4000;

export type FloorHandoff = { dir: "out" | "in"; peer: string; ts: number };

type HandoffRow = { ts: number; kind: string; session?: string | null; from_?: string | null; to_?: string | null };

/**
 * Transient handoff state per desk name. A `session_message` from A to B newer
 * than `sinceTs` (the previous refresh) and younger than HANDOFF_MS gives A an
 * "out" bubble and B an "in" bubble. The latest event wins per desk.
 */
export function deriveHandoffs(rows: HandoffRow[], sinceTs: number, nowMs = Date.now()): Map<string, FloorHandoff> {
  const out = new Map<string, FloorHandoff>();
  const live = rows
    .filter((r) => r.kind === "session_message" && r.ts > sinceTs && nowMs - r.ts < HANDOFF_MS)
    .sort((a, b) => a.ts - b.ts);
  for (const r of live) {
    const from = r.from_ ?? r.session;
    const to = r.to_;
    if (!from || !to || from === to) continue;
    out.set(from, { dir: "out", peer: to, ts: r.ts });
    out.set(to, { dir: "in", peer: from, ts: r.ts });
  }
  return out;
}

export const handoffLabel = (h: FloorHandoff, peerLabel = h.peer): string => (h.dir === "out" ? `→ ${peerLabel}` : `← ${peerLabel}`);
