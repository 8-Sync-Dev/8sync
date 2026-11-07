// The two ways a message enters a group turn (lib/server/groups.ts): the owner's message to a group
// (POST /api/groups/[id]/send → `groupSend`) and a room's message while it answers a turn (POST
// /api/messages from a room → `roomSend`). Delivery, the Chief of Staff and the log come in as deps,
// so the rules are tested without rooms (tests/groups.test.ts).
import { parseMentions, type MentionBot } from "../bot-mention";
import { readHopLine, ownerGroupText, roomGroupText, hopLine, type GroupGuard, type Group, type GroupLogEntry } from "./groups";

/** One delivery as the routes report it (deliverText's result, or a dialog open in the pane). */
export type Delivered = { delivery: string; error: string | null; waiting?: boolean; [k: string]: unknown };

export type GroupSendDeps = {
  guard: GroupGuard;
  /** Live bots and their handles (lib/bot-mention.ts mentionBots over the office rooms). */
  bots: readonly MentionBot[];
  deliver: (room: string, text: string) => Promise<Delivered>;
  /** "chief" mode, no @: hands the text to the Chief of Staff (lib/server/chief.ts chiefAsk) limited to `members`; null when the chief is off. */
  chief: ((text: string, members: readonly string[]) => Promise<{ room: string; result: Delivered } | { error: string }>) | null;
  log: (e: Omit<GroupLogEntry, "n">) => void;
  now?: number;
};

export type GroupSendResult = {
  turn: string;
  delivered: { room: string; delivery: string; error: string | null }[];
  held: { room: string; reason: "max-parallel" | "session-waiting" }[];
  /** Live bots the owner named that are not in the group ("Thêm vào nhóm?"). */
  notMembers: string[];
  /** "@words" no live bot answers to (a file name, a typo). */
  unknown: string[];
  /** "chief" mode: the Chief of Staff room it went to, or why it could not. */
  chief: { room: string } | { error: string } | null;
};

/**
 * The owner's `text` to group `g`: each @-named member gets it (the owner's words, the group line under
 * them), at most `maxParallel` at once; one showing a dialog is held, never queued. Only live bots have a
 * handle, so a member whose room ended cannot be named (the UI shows it asleep). No @: logged only
 * ("mention"), or to the Chief of Staff ("chief"). Every call starts a new turn.
 */
export async function groupSend(g: Group, text: string, d: GroupSendDeps): Promise<GroupSendResult> {
  const now = d.now ?? Date.now();
  const named = parseMentions(text, d.bots);
  const members = named.bots.filter((id) => g.members.includes(id));
  const notMembers = named.bots.filter((id) => !g.members.includes(id));
  const held: GroupSendResult["held"] = members.slice(g.maxParallel).map((room) => ({ room, reason: "max-parallel" as const }));
  const sendable = members.slice(0, g.maxParallel);
  let chief: GroupSendResult["chief"] = null;
  const delivered: GroupSendResult["delivered"] = [];

  if (members.length === 0 && g.mode === "chief") {
    const turn = d.guard.startTurn(g, [], now);
    if (!d.chief) chief = { error: "Chief of Staff đang tắt: bật ở tab Máy, hoặc @ tên bot" };
    else {
      const r = await d.chief(`${text}\n\n${hopLine(g.name, 0, g.maxHops)} Chỉ giao cho các bot trong nhóm này.`, g.members);
      if ("error" in r) chief = { error: r.error };
      else {
        chief = { room: r.room };
        // The chief answers the turn: what it hands the members counts like any bot→bot message.
        delivered.push({ room: r.room, delivery: r.result.delivery, error: r.result.error });
        d.guard.join(turn, r.room);
      }
    }
    d.log({ ts: now, turn, kind: "owner", from: "owner", to: delivered.map((x) => x.room), text, hop: 0 });
    return { turn, delivered, held, notMembers, unknown: named.unknown, chief };
  }

  const turn = d.guard.startTurn(g, sendable, now);
  const body = ownerGroupText(text, g);
  for (const room of sendable) {
    const r = await d.deliver(room, body);
    if (r.waiting) {
      d.guard.leave(room);
      held.push({ room, reason: "session-waiting" });
    } else delivered.push({ room, delivery: r.delivery, error: r.error });
  }
  d.log({ ts: now, turn, kind: "owner", from: "owner", to: delivered.map((x) => x.room), text, hop: 0 });
  return { turn, delivered, held, notMembers, unknown: named.unknown, chief };
}

export type RoomSendDeps = {
  guard: GroupGuard;
  groups: readonly Pick<Group, "id" | "name">[];
  deliver: (text: string) => Promise<Delivered>;
  log: (group: string, e: Omit<GroupLogEntry, "n">) => void;
  /** What one message may hold: the hop line is left out when it would push past it. */
  max: number;
  now?: number;
};

export type RoomSendResult =
  | { status: 201; body: Delivered }
  | { status: 200; body: { delivery: "dropped"; error: string; message: null } }
  | { status: 409; body: { error: "hop-limit"; turn: string | null; group: string | null; hop: number; max: number; detail: string } }
  | { status: 409; body: { error: "pair-limit"; from: string; to: string; count: number; max: number; detail: string } };

/**
 * A room's message to `to` (`from`: the sending room's address when HQ found it). Outside any group turn
 * it goes as before (no line added) under the pair guard: the same text from the same pair within 60 s
 * is dropped, past 12 per pair in 10 min it is refused (409 pair-limit) until the owner writes to either
 * room. Inside a turn it gets the hop line, is counted, dropped when it repeats itself within 60 s, and
 * refused (409 hop-limit) past the turn's limits.
 */
export async function roomSend(from: string | null, to: string, text: string, d: RoomSendDeps): Promise<RoomSendResult> {
  const now = d.now ?? Date.now();
  const c = d.guard.check(from, text, now);
  if (c.kind === "free") {
    if (!from || from === to) return { status: 201, body: await d.deliver(text) };
    const p = d.guard.pairCheck(from, to, text, now);
    if (p.kind === "duplicate") return { status: 200, body: { delivery: "dropped", error: "duplicate: cùng nội dung đã gửi tới phòng này dưới 60 giây", message: null } };
    if (p.kind === "pair-limit") {
      const detail = `${from} đã gửi ${to} ${p.count} tin trong 10 phút: dừng, chờ owner nhắn một trong hai phòng rồi mới gửi tiếp, không gửi lặp.`;
      return { status: 409, body: { error: "pair-limit", from, to, count: p.count, max: p.max, detail } };
    }
    const r = await d.deliver(text);
    if (!r.waiting) d.guard.pairCommit(from, to, text, now);
    return { status: 201, body: r };
  }
  if (c.kind === "duplicate") {
    d.log(c.group, { ts: now, turn: c.turn, kind: "dropped", from: from ?? "?", to: [to], text, hop: 0 });
    return { status: 200, body: { delivery: "dropped", error: "duplicate: cùng nội dung đã gửi trong lượt này dưới 60 giây", message: null } };
  }
  if (c.kind === "hop-limit") {
    if (c.group && c.turn) d.log(c.group, { ts: now, turn: c.turn, kind: "held", from: from ?? "?", to: [to], text, hop: c.hop });
    const detail = c.turn
      ? `Lượt này của nhóm đã đủ ${c.maxMsgs} tin bot↔bot hoặc ${c.max} hop: chờ owner bấm "Cho thêm" rồi gửi lại, không gửi lặp.`
      : `Tin này đã ở hop ${readHopLine(text)?.hop ?? c.hop - 1}/${c.max}: không chuyển tiếp nữa, báo owner.`;
    return { status: 409, body: { error: "hop-limit", turn: c.turn, group: c.group, hop: c.hop, max: c.max, detail } };
  }
  const name = d.groups.find((g) => g.id === c.group)?.name ?? c.name;
  const withLine = roomGroupText(text, name, c.hop, c.hopCap);
  const r = await d.deliver([...withLine].length <= d.max ? withLine : text);
  if (!r.waiting && from) {
    d.guard.commit(c, from, to, text, now);
    d.log(c.group, { ts: now, turn: c.turn, kind: "room", from, to: [to], text, hop: c.hop });
  }
  return { status: 201, body: r };
}
