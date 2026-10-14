// "Không ai rảnh" status (pure, client-safe). `8sync ccc hook idle` writes one JSON per agent-team
// member (crates/cli/src/verbs/ccc/idle.rs); the server reader is lib/server/idle.ts.
// Tested in tests/idle.test.ts.

export const IDLE_STATES = ["working", "recall", "ask_lead", "ask_room", "rest"] as const;
export type IdleState = (typeof IDLE_STATES)[number];

export type IdleRecord = {
  team: string;
  name: string;
  state: IdleState;
  detail: string;
  /** Unix seconds. */
  ts: number;
};

/** Older than this, a record is history, not a live state. */
export const IDLE_STALE_MS = 6 * 3600_000;
/** "Nghỉ lâu": resting longer than this counts in the office header. */
export const IDLE_LONG_REST_MS = 10 * 60_000;

const SAFE = /^[A-Za-z0-9_.-]{1,80}$/;

/** A status file's JSON, or null when it is not a schema-1 record. Detail is one line, ≤ 300 chars. */
export function parseIdleRecord(v: unknown): IdleRecord | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.schema !== 1) return null;
  if (typeof o.team !== "string" || !SAFE.test(o.team)) return null;
  if (typeof o.name !== "string" || !SAFE.test(o.name)) return null;
  if (typeof o.state !== "string" || !(IDLE_STATES as readonly string[]).includes(o.state)) return null;
  if (typeof o.ts !== "number" || !Number.isFinite(o.ts) || o.ts <= 0) return null;
  const detail = typeof o.detail === "string" ? o.detail.split(/\r?\n/)[0].trim().slice(0, 300) : "";
  return { team: o.team, name: o.name, state: o.state as IdleState, detail, ts: o.ts };
}

export function isStale(r: Pick<IdleRecord, "ts">, now = Date.now()): boolean {
  return now - r.ts * 1000 > IDLE_STALE_MS;
}

/** Team name the hook uses for a lead session: "session-" + first 8 chars of its session id. */
export function teamOf(sessionId: string | null | undefined): string | null {
  return sessionId && sessionId.length >= 8 ? `session-${sessionId.slice(0, 8)}` : null;
}

/** The room named in an ask_room detail ("… Phòng zus (ab12cd34) còn 3 task mở …"), id dropped. */
export function roomOfDetail(detail: string): string | null {
  const m = /Phòng\s+(.+?)\s+còn\s+\d+\s+task/i.exec(detail);
  if (!m) return null;
  const name = m[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
  return name || null;
}

export type IdleIcon = "working" | "recall" | "ask" | "rest";
export type IdleTone = "running" | "needs" | "idle";

/** Label + icon + tone: the icon and text carry the state, the tone only reinforces it. */
export function idleView(r: Pick<IdleRecord, "state" | "detail">): { label: string; icon: IdleIcon; tone: IdleTone } {
  switch (r.state) {
    case "working":
      return { label: "đang làm", icon: "working", tone: "running" };
    case "recall":
      return { label: "đang hồi ức", icon: "recall", tone: "running" };
    case "ask_lead":
      return { label: "đang hỏi lead", icon: "ask", tone: "needs" };
    case "ask_room":
      return { label: `đang hỏi phòng ${roomOfDetail(r.detail) ?? "khác"}`, icon: "ask", tone: "needs" };
    case "rest":
      return { label: r.detail ? `nghỉ: ${r.detail}` : "nghỉ", icon: "rest", tone: "idle" };
  }
}

/** Lead first, then teammates by name. */
export function sortMembers<T extends Pick<IdleRecord, "name">>(rs: T[]): T[] {
  return [...rs].sort((a, b) => (a.name === "lead" ? -1 : b.name === "lead" ? 1 : a.name.localeCompare(b.name)));
}

/** Members resting longer than IDLE_LONG_REST_MS (live records only). */
export function longRestCount(rs: IdleRecord[], now = Date.now()): number {
  return rs.filter((r) => r.state === "rest" && !isStale(r, now) && now - r.ts * 1000 > IDLE_LONG_REST_MS).length;
}
