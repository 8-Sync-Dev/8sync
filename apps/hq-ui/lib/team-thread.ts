// Pure: merge journal-derived message rows into one chronological team thread.
// Input rows are the `messages` API rows (owner_message, session_reply,
// session_message, notification, session_start/end).

export type ThreadRow = {
  id?: number;
  ts: number;
  session: string | null;
  kind: string;
  from_: string | null;
  to_: string | null;
  text: string | null;
  from_name?: string | null;
  to_name?: string | null;
};

export type ThreadKind =
  | "owner"
  | "reply"
  | "handoff"
  | "needs_you"
  | "session_start"
  | "session_end";

export type ThreadItem = {
  key: string;
  kind: ThreadKind;
  ts: number;
  /** Desk the item belongs to (the target for owner messages, the author otherwise). */
  session: string | null;
  from: string | null;
  to: string | null;
  text: string;
  role: string | null;
  /** Consecutive identical items folded into this one. */
  count: number;
  /** needs_you only: no owner message to that session since. */
  open?: boolean;
  /** Session names for display ("rd") when the ids are uuids. */
  fromName?: string | null;
  toName?: string | null;
  /** handoff only: the recipient wrote back to the sender afterwards. */
  answered?: boolean;
};

export type ThreadFilters = {
  session?: string | null;
  role?: string | null;
  /** Role of a session; used for the role filter. */
  roleOf?: (session: string) => string | null | undefined;
};

const KIND: Record<string, ThreadKind> = {
  owner_message: "owner",
  session_reply: "reply",
  session_message: "handoff",
  notification: "needs_you",
  session_start: "session_start",
  session_end: "session_end",
};

/** Folded when repeated back to back for the same session. */
const NOISE = new Set<ThreadKind>(["needs_you", "session_start", "session_end"]);

/** `core [ff2607]` → `core`: the ref ListAgents appends to a session name. */
export const partyKey = (s: string | null | undefined) => (s ?? "").replace(/\s*\[[0-9a-z]+\]$/i, "").trim().toLowerCase();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Two message parties are the same session. Both resolved to a session id: the ids decide (two
 * sessions may share a name). Otherwise any of their names/ids lining up is enough.
 */
function sameParty(a: string | null, aName: string | null | undefined, b: string | null, bName: string | null | undefined): boolean {
  if (a && b && UUID.test(a) && UUID.test(b)) return a.toLowerCase() === b.toLowerCase();
  const keys = (id: string | null, name: string | null | undefined) => [partyKey(id), partyKey(name)].filter(Boolean);
  const ka = keys(a, aName);
  return keys(b, bName).some((k) => ka.includes(k));
}

/** Older journal rows stored the sender as "***" (the masker hid a uuid session id); fall back to the row's session. */
const sender = (r: ThreadRow) => (r.from_ && r.from_ !== "***" ? r.from_ : r.session);

export function buildTeamThread(rows: ThreadRow[], filters: ThreadFilters = {}): ThreadItem[] {
  const roleOfSession = (s: string | null) => (s ? (filters.roleOf?.(s) ?? null) : null);

  const sorted = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.kind in KIND)
    .sort((a, b) => a.r.ts - b.r.ts || (a.r.id ?? a.i) - (b.r.id ?? b.i));

  const items: ThreadItem[] = [];
  for (const { r, i } of sorted) {
    const kind = KIND[r.kind];
    const session = kind === "handoff" ? sender(r) : r.session;
    const from = kind === "owner" ? "owner" : kind === "handoff" ? session : sender(r);
    const to = kind === "owner" ? (r.to_ ?? r.session) : kind === "reply" ? "owner" : kind === "handoff" ? r.to_ : null;
    const role = roleOfSession(session);
    const item: ThreadItem = {
      key: `${r.id ?? `i${i}`}`,
      kind,
      ts: r.ts,
      session: kind === "owner" ? (r.to_ && r.to_ !== "owner" ? r.to_ : r.session) : session,
      from,
      to,
      text: (r.text ?? "").trim(),
      role,
      count: 1,
      ...(kind === "handoff" ? { fromName: r.from_name ?? null, toName: r.to_name ?? null } : {}),
    };
    const prev = items.at(-1);
    if (prev && prev.kind === kind && prev.session === item.session && prev.to === item.to && (NOISE.has(kind) || prev.text === item.text)) {
      prev.count++;
      prev.ts = item.ts;
      prev.key = item.key;
      continue;
    }
    items.push(item);
  }

  // A needs-you stays open until the owner writes to that session.
  const lastOwner = new Map<string, number>();
  for (const it of items) if (it.kind === "owner" && it.session) lastOwner.set(it.session, it.ts);
  for (const it of items) if (it.kind === "needs_you") it.open = !it.session || (lastOwner.get(it.session) ?? -1) < it.ts;

  // A handoff A -> B is answered once B sends a message back to A. Compared by resolved name
  // (`from_name`/`to_name`), falling back to the raw address: the journal keeps `to` as the text
  // SendMessage was given ("core [ff2607]") when it could not resolve it, while the reply's
  // `from` is a session uuid — raw ids alone never match.
  for (const it of items) {
    if (it.kind !== "handoff") continue;
    it.answered = items.some((x) => x.kind === "handoff" && x.ts > it.ts && sameParty(x.from, x.fromName, it.to, it.toName) && sameParty(x.to, x.toName, it.from, it.fromName));
  }

  const { session, role } = filters;
  return items.filter((it) => {
    if (session && it.session !== session && it.from !== session && it.to !== session) return false;
    if (role && it.role !== role && !(it.kind === "handoff" && (roleOfSession(it.to) === role || roleOfSession(it.from) === role))) return false;
    return true;
  });
}
