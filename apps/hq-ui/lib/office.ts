// Pure office model (no I/O): every live session is a room; the same specialist seats in
// every room; specialists walk to another room when its session messages that one.
// Tested in tests/office.test.ts.

/** The seat template every room has, in display order. */
export const SEATS = [
  { key: "lead", label: "Lead", hint: "the session itself" },
  { key: "rd", label: "R&D", hint: "explore · researcher" },
  { key: "plan", label: "Plan", hint: "pm · architect · Plan" },
  { key: "dev", label: "Fullstack", hint: "task · general-purpose · designer" },
  { key: "review", label: "Reviewer", hint: "reviewer · verifier" },
  { key: "qa", label: "Tester", hint: "qa" },
  { key: "quick", label: "Quick", hint: "quick-task" },
  { key: "critic", label: "Critic", hint: "critic — phê bình, chọn thay owner" },
] as const;

export type SeatKey = (typeof SEATS)[number]["key"];

const BY_TYPE: Record<string, SeatKey> = {
  explore: "rd",
  researcher: "rd",
  "claude-code-guide": "rd",
  plan: "plan",
  pm: "plan",
  architect: "plan",
  task: "dev",
  "general-purpose": "dev",
  designer: "dev",
  claude: "dev",
  reviewer: "review",
  verifier: "review",
  qa: "qa",
  "quick-task": "quick",
  critic: "critic",
};

/** Kit / built-in agent type -> seat. Plugin-scoped names ("plugin:reviewer") use the last part. */
export function seatOf(agentType: string | null | undefined): SeatKey {
  const t = (agentType ?? "").toLowerCase().split(":").pop()!.trim();
  return BY_TYPE[t] ?? "dev";
}

export type AgentRow = { agent_id: string; agent_type: string | null; started_at: number; ended_at: number | null };

export type Seat = {
  key: SeatKey;
  label: string;
  /** Specialists working in this seat right now (agent types, newest first). */
  active: string[];
  /** Finished in the recent window: shown dimmed, "vừa xong". */
  recent: number;
};

/** Agents still running count as active; ones that stopped within `recentMs` as recent. */
export function seatsFor(agents: AgentRow[], leadBusy: boolean, now: number, recentMs = 10 * 60_000): Seat[] {
  return SEATS.map((s) => {
    if (s.key === "lead") return { key: s.key, label: s.label, active: leadBusy ? ["lead"] : [], recent: 0 };
    const mine = agents.filter((a) => seatOf(a.agent_type) === s.key);
    const active = mine
      .filter((a) => a.ended_at == null)
      .sort((a, b) => b.started_at - a.started_at)
      .map((a) => a.agent_type ?? "agent");
    const recent = mine.filter((a) => a.ended_at != null && now - a.ended_at < recentMs).length;
    return { key: s.key, label: s.label, active, recent };
  });
}

export type RoomRef = { key: string; ids: string[] };

/** The room a sender/recipient name points at: session name, Claude session id (or its 8-char prefix), or label. */
export function roomFor(name: string | null | undefined, rooms: RoomRef[]): string | null {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  if (!n) return null;
  const hit = rooms.find((r) => r.ids.some((id) => id.toLowerCase() === n || (n.length >= 8 && id.toLowerCase().startsWith(n))));
  return hit?.key ?? null;
}

export type Visit = { from: string; to: string; ts: number; text: string | null };

/** session_message rows in the last `windowMs` between two different rooms -> walks between rooms. */
export function visitsFrom(
  messages: { kind: string; ts: number; session: string | null; from_: string | null; to_: string | null; text: string | null }[],
  rooms: RoomRef[],
  now: number,
  windowMs = 120_000,
): Visit[] {
  const out: Visit[] = [];
  for (const m of messages) {
    if (m.kind !== "session_message" || now - m.ts > windowMs) continue;
    const from = roomFor(m.from_, rooms) ?? roomFor(m.session, rooms);
    const to = roomFor(m.to_, rooms);
    if (from && to && from !== to) out.push({ from, to, ts: m.ts, text: m.text ? m.text.slice(0, 140) : null });
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 12);
}

export type Usage = {
  cost_usd: number | null;
  duration_ms: number | null;
  lines_added: number | null;
  lines_removed: number | null;
  context_pct: number | null;
  model: string | null;
};

/** cost / finished tasks, only when both are known (never an invented price). */
export function costPerTask(cost: number | null | undefined, done: number): number | null {
  return cost != null && Number.isFinite(cost) && done > 0 ? cost / done : null;
}

export type ProjectInfo = { root: string; name: string; branch: string | null };

/** Group room keys under their project root; rooms without a git root go under their cwd. */
export function groupByProject<T extends { key: string; project: ProjectInfo | null; cwd: string | null }>(
  rooms: T[],
): { project: ProjectInfo; rooms: T[] }[] {
  const map = new Map<string, { project: ProjectInfo; rooms: T[] }>();
  for (const r of rooms) {
    const p = r.project ?? { root: r.cwd ?? "?", name: (r.cwd ?? "?").split(/[\\/]/).filter(Boolean).pop() ?? "?", branch: null };
    const k = p.root.toLowerCase();
    if (!map.has(k)) map.set(k, { project: p, rooms: [] });
    map.get(k)!.rooms.push(r);
  }
  return [...map.values()].sort((a, b) => a.project.name.localeCompare(b.project.name));
}

/** What a seat's sprite does: the lead mirrors the session, a running specialist types, an empty seat is null. */
export function seatState(
  seat: Pick<Seat, "key" | "active">,
  room: { status: string; state: string | null; waiting: string | null },
): "idle" | "typing" | "running" | "reading" | "waiting" | "stalled" | "done" | "meeting" | null {
  if (seat.key !== "lead") return seat.active.length ? "typing" : null;
  if (room.waiting || room.status === "needs_input") return "waiting";
  const known = ["idle", "typing", "running", "reading", "waiting", "stalled", "done", "meeting"] as const;
  const st = known.find((k) => k === room.state);
  if (st) return st;
  return room.status === "running" ? "typing" : "idle";
}

/** A session picked by any of its names: hq name, Claude session id (or an 8+ char prefix), or label. */
export function matchesSession(s: { name: string; session_id: string | null; label?: string | null }, key: string | null): boolean {
  if (!key) return false;
  if (s.name === key || s.session_id === key || (s.label != null && s.label === key)) return true;
  return key.length >= 8 && s.session_id != null && s.session_id.startsWith(key);
}

export type RoomStats = {
  tokens: number | null;
  usage: Usage | null;
  tasks: { done: number; open: number };
};

/** Office-wide totals. A sum is null when no room measured it (never shown as 0). */
export function officeTotals(rooms: RoomStats[]) {
  const sum = (xs: (number | null | undefined)[]) => {
    const k = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return k.length ? k.reduce((a, b) => a + b, 0) : null;
  };
  const cost = sum(rooms.map((r) => r.usage?.cost_usd));
  const done = rooms.reduce((a, r) => a + r.tasks.done, 0);
  // $/task only over rooms that measured cost, so unmeasured rooms do not dilute it.
  const measuredDone = rooms.filter((r) => r.usage?.cost_usd != null).reduce((a, r) => a + r.tasks.done, 0);
  return {
    rooms: rooms.length,
    tokens: sum(rooms.map((r) => r.tokens)),
    cost_usd: cost,
    duration_ms: sum(rooms.map((r) => r.usage?.duration_ms)),
    lines_added: sum(rooms.map((r) => r.usage?.lines_added)),
    lines_removed: sum(rooms.map((r) => r.usage?.lines_removed)),
    done,
    open: rooms.reduce((a, r) => a + r.tasks.open, 0),
    cost_per_task: costPerTask(cost, measuredDone),
    measured: rooms.filter((r) => r.usage?.cost_usd != null).length,
  };
}

export function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "chưa đo";
  return v < 0.01 && v > 0 ? "<$0.01" : `$${v.toFixed(2)}`;
}

export function fmtTokens(v: number | null | undefined): string {
  if (v == null) return "chưa đo";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${Math.round(v / 1000)}k`;
  return String(v);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "chưa đo";
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m} phút` : `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}
