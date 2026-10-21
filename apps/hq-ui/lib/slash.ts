// "/…" commands in the shared composer (components/hq/room-send.tsx), owner 2026-10-21: "input chat
// to all phòng hoặc 1 phòng nên có command /… ví như hq-auto-ship là auto rnd, optimize, nâng cấp, cải
// tiến, check sec, check thiếu, loop làm liên tục". Pure rules, tested in tests/slash.test.ts.
//
// - `/all <tin>`: every room of the project in view, `/<phòng> <tin>`: one room, for this send only.
// - `/hq-*` presets expand here into a brief headed `[HQ /hq-…]`: a leading "/" never reaches a Claude
//   Code terminal (it would run Claude Code's own command). They go to the project's lead room when
//   there is one. `/hq-auto-ship` also turns on the project's loop (`8sync ccc auto loop on`, whose
//   revive tick sends the lead each next round: crates/cli/src/verbs/ccc/ship_loop.rs); `/hq-stop` turns it off.
// - `//text` sends "/text" as typed.

import { rootKey } from "./preview";
import type { SendTarget } from "./room-send";

export type SlashRoom = { key: string; name: string; label: string };

export type Preset = {
  cmd: string;
  desc: string;
  /** The project's auto-ship loop this preset turns on or off. */
  loop?: "on" | "off";
  brief: (focus: string | null) => string;
};

const RULES =
  'Luật: card nhỏ; "xong" phải có bằng chứng (lệnh kiểm + kết quả); không thao tác phá huỷ; tôn trọng guard CPU/RAM của owner; không release ngoài cổng thường của team.';
const CARD = 'Mỗi phát hiện đáng làm → MỘT card nhỏ: `8sync ccc auto add "<việc>" --check "<lệnh kiểm>"`; team build/review/merge theo luồng auto thường.';
const at = (focus: string | null) => (focus ? ` · trọng tâm: ${focus}` : "");

/** One round of one kind of work: the header, what to look at, then the card and safety rules. */
const round = (cmd: string, title: string, what: string) => (focus: string | null) => `[HQ /${cmd}] ${title}${at(focus)}.\n${what}\n${CARD}\n${RULES}`;

/** Built in (no config file): what the owner asked for, one line each in the menu. */
export const PRESETS: readonly Preset[] = [
  {
    cmd: "hq-auto-ship",
    desc: "Vòng liên tục: R&D, optimize, nâng cấp, cải tiến, check sec, check thiếu → card → ship; tự sang vòng kế",
    loop: "on",
    brief: (focus) =>
      `[HQ /hq-auto-ship] Bật vòng auto-ship liên tục${at(focus)}. Lead điều phối; mỗi vòng:\n` +
      "1. R&D: còn thiếu gì / làm tốt hơn gì so với công cụ tương tự, docs.\n" +
      "2. Optimize: hiệu năng, kích thước, token.\n" +
      "3. Nâng cấp: deps/toolchain, chỉ bản an toàn.\n" +
      "4. Cải tiến: UX, chất lượng code.\n" +
      "5. Check sec: secret, audit deps, OWASP trên diff gần đây.\n" +
      "6. Check thiếu: test, docs, đường lỗi, tính năng làm dở.\n" +
      `${CARD}\n` +
      "Hết card một vòng thì thôi: 8sync tự gửi vòng kế khi board cạn (≥ 20 phút một vòng, không gửi khi guard đang giữ máy).\n" +
      `${RULES}\nDừng: owner nói "dừng" hoặc /hq-stop.`,
  },
  { cmd: "hq-rnd", desc: "Một vòng R&D: thiếu gì, làm tốt hơn gì so với công cụ tương tự", brief: round("hq-rnd", "Một vòng R&D", "So với công cụ tương tự còn thiếu gì, làm tốt hơn được gì; đọc docs chính thức, ghi nguồn. Vòng này không sửa code.") },
  { cmd: "hq-optimize", desc: "Một vòng optimize: hiệu năng, kích thước, token", brief: round("hq-optimize", "Một vòng optimize", "Đo trước (hiệu năng, kích thước bundle/binary, token mỗi lượt), tìm chỗ tốn nhất; card nào cũng có số đo trước và sau.") },
  { cmd: "hq-upgrade", desc: "Một vòng nâng cấp deps/toolchain an toàn", brief: round("hq-upgrade", "Một vòng nâng cấp", "Deps/toolchain cũ: chỉ bản an toàn, đọc changelog/breaking change, mỗi nâng cấp một card có test xanh.") },
  { cmd: "hq-improve", desc: "Một vòng cải tiến UX và chất lượng code", brief: round("hq-improve", "Một vòng cải tiến", "UX (luồng rối, chữ khó hiểu, trạng thái thiếu) và chất lượng code (trùng lặp, hàm quá dài, tên tối nghĩa).") },
  { cmd: "hq-sec", desc: "Một vòng check sec: secret, audit deps, OWASP", brief: round("hq-sec", "Một vòng check sec", "Như /sec: secret trong repo/diff, audit deps, OWASP trên diff gần đây; lỗi nặng lên P0.") },
  { cmd: "hq-gaps", desc: "Một vòng check thiếu: test, docs, đường lỗi, việc làm dở", brief: round("hq-gaps", "Một vòng check thiếu", "Test còn thiếu, docs lệch code, đường lỗi chưa xử lý, tính năng làm dở.") },
  {
    cmd: "hq-stop",
    desc: "Dừng vòng auto-ship sau các card đang làm",
    loop: "off",
    brief: (focus) => `[HQ /hq-stop] Dừng vòng auto-ship${at(focus)}: làm xong các card đang làm theo luồng thường, không mở vòng mới, không thêm card auto-ship.`,
  },
];

export type MenuRow = { cmd: string; desc: string; kind: "all" | "room" | "preset" };

/** The "/word" being typed: the text starts with "/" and the caret is still inside that first word. */
export function slashAt(text: string, caret: number): { prefix: string; end: number } | null {
  const m = /^\/([^\s/]*)/.exec(text);
  if (!m || text.startsWith("//") || caret < 1 || caret > m[0].length) return null;
  return { prefix: m[1], end: m[0].length };
}

/** Menu rows for `prefix` (case-insensitive prefix): `/all`, the project's rooms, then the presets. */
export function slashMenu(prefix: string, rooms: SlashRoom[], max = 14): MenuRow[] {
  const p = prefix.toLowerCase();
  const rows: MenuRow[] = [
    ...(rooms.length ? [{ cmd: "all", desc: `Mọi phòng của dự án (${rooms.length} phòng), chỉ lần gửi này`, kind: "all" as const }] : []),
    ...rooms.map((r) => ({ cmd: r.label, desc: `Chỉ phòng ${r.label}, lần gửi này`, kind: "room" as const })),
    ...PRESETS.map((x) => ({ cmd: x.cmd, desc: x.desc, kind: "preset" as const })),
  ];
  return rows.filter((r) => r.cmd.toLowerCase().startsWith(p)).slice(0, max);
}

/** Put the picked command in place of the typed "/word", followed by one space. */
export function applySlash(text: string, end: number, row: MenuRow): { text: string; caret: number } {
  const rest = text.slice(end).replace(/^\s+/, "");
  const head = `/${row.cmd} `;
  return { text: head + rest, caret: head.length };
}

export type Slash =
  | { kind: "none"; text: string }
  | { kind: "all"; body: string }
  | { kind: "room"; room: SlashRoom; body: string }
  | { kind: "preset"; preset: Preset; focus: string | null }
  | { kind: "error"; error: string };

/** What a typed message means: a command only when the text starts with "/<word>" (word: letters, digits, - and _). */
export function parseSlash(text: string, rooms: SlashRoom[]): Slash {
  const t = text.trim();
  if (t.startsWith("//")) return { kind: "none", text: t.slice(1) };
  const m = /^\/([\p{L}\p{N}][\p{L}\p{N}_-]*)(?:\s+([\s\S]*))?$/u.exec(t);
  if (!m) return { kind: "none", text: t };
  const cmd = m[1].toLowerCase();
  const body = (m[2] ?? "").trim();
  const preset = PRESETS.find((p) => p.cmd === cmd);
  if (preset) return { kind: "preset", preset, focus: body || null };
  if (cmd === "all") return body ? { kind: "all", body } : { kind: "error", error: "/all cần nội dung tin sau lệnh" };
  const room = rooms.find((r) => r.label.toLowerCase() === cmd) ?? rooms.find((r) => r.name.toLowerCase() === cmd);
  if (!room) return { kind: "error", error: `Không có lệnh hay phòng /${m[1]} trong dự án này: gõ / để xem danh sách (//… để gửi nguyên dấu /)` };
  return body ? { kind: "room", room, body } : { kind: "error", error: `/${m[1]} cần nội dung tin sau tên phòng` };
}

export type SlashSend =
  | { ok: true; target: SendTarget; text: string; loop: { on: boolean; root: string; focus: string | null } | null }
  | { ok: false; error: string };

/**
 * Where and what a parsed command sends: `/all` → every room of the project in view (`root`), a room
 * command → that room, a preset → the project's lead room, else the composer's own target.
 * `none` keeps the composer's target and text.
 */
export function slashSend(s: Slash, ctx: { target: SendTarget; root: string | null; lead: SlashRoom | null }): SlashSend {
  switch (s.kind) {
    case "error":
      return { ok: false, error: s.error };
    case "none":
      return { ok: true, target: ctx.target, text: s.text, loop: null };
    case "all":
      return ctx.root ? { ok: true, target: { kind: "all", root: ctx.root }, text: s.body, loop: null } : { ok: false, error: "/all: chọn một dự án trước (ô Gửi tới)" };
    case "room":
      return { ok: true, target: { kind: "room", key: s.room.key }, text: s.body, loop: null };
    case "preset": {
      if (s.preset.loop && !ctx.root) return { ok: false, error: `/${s.preset.cmd}: chọn một dự án trước (ô Gửi tới)` };
      const loop = s.preset.loop && ctx.root ? { on: s.preset.loop === "on", root: ctx.root, focus: s.focus } : null;
      return { ok: true, target: ctx.lead ? { kind: "room", key: ctx.lead.key } : ctx.target, text: s.preset.brief(s.focus), loop };
    }
  }
}

/**
 * One project's auto-ship loop (`auto status --json` `ship_loops`, keyed by the canonical root).
 * `next`: why the next round waits (crates/cli/src/verbs/ccc/ship_loop.rs `next_reason`), null = due.
 */
export type ShipLoop = { root: string; round: number; focus: string | null; since: number | null; next: string | null };

/** `ship_loops` → valid loops only; anything else (older 8sync, junk) → none. */
export function shipLoops(v: unknown): ShipLoop[] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([root, l]) => {
    if (!root || !l || typeof l !== "object") return [];
    const o = l as Record<string, unknown>;
    const round = typeof o.round === "number" && Number.isInteger(o.round) && o.round > 0 ? o.round : 1;
    const str = (x: unknown) => (typeof x === "string" && x ? x : null);
    return [{ root, round, focus: str(o.focus), since: typeof o.since === "number" ? o.since : null, next: str(o.next_reason) }];
  });
}

/** The chip's wait words for a resting loop (it goes on by itself once that clears); null = nothing to say. */
export function loopWait(next: string | null): string | null {
  return next === "usage" ? "chờ usage" : next === "guard" ? "chờ máy rảnh" : next === "auto" ? "auto đang dừng" : null;
}

/** The loop of project `root` (`\` vs `/`, case and Rust's `\\?\` prefix ignored), or null. */
export function loopFor(loops: ShipLoop[], root: string): ShipLoop | null {
  const k = rootKey(root);
  return loops.find((l) => rootKey(l.root) === k) ?? null;
}
