// Chief of Staff: the one room the owner talks to. `POST /api/chief/ask` hands it the owner's words
// with the live rooms (lib/server/brief.ts) as a compact table and the rule to route work with
// hq-control's `send`, follow up, check results and come back only for a decision. Delivery is the
// same as any message (lib/server/deliver.ts deliverText): no second path into a room.
// The setting lives in ~/.config/8sync/hq/chief.json: `{room, on}`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Brief } from "./brief";
import { isInboxId } from "./inbox";
import { configDir } from "./paths";
import { isTmuxName } from "./validate";

export type ChiefConfig = { room: string | null; on: boolean };
export const CHIEF_DEFAULT: ChiefConfig = { room: null, on: false };
export const chiefFile = () => path.join(configDir(), "chief.json");
/** GET/PUT /api/chief: the setting, whether its room is live, and the live rooms a picker offers. */
export type ChiefView = {
  cfg: ChiefConfig;
  live: boolean;
  rooms: { id: string; label: string; project: string | null; engine: "claude" | "omp"; status: string }[];
};

/** A room id HQ can deliver to: an hq-* tmux name, a Claude session id or an omp room id. */
export const isRoomId = (v: unknown): v is string => isInboxId(v) || isTmuxName(v);

/**
 * A PUT body over the current setting: fields left out keep their value, `room: null` clears it (and
 * turns the chief off). Errors: a room that is not a room id, `on` not a boolean, on without a room.
 */
export function normChief(v: unknown, base: ChiefConfig = CHIEF_DEFAULT): { ok: true; value: ChiefConfig } | { ok: false; error: string } {
  if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Cần JSON {room?, on?}" };
  const r = v as Record<string, unknown>;
  if ("room" in r && r.room !== null && !isRoomId(r.room)) return { ok: false, error: "room: id của một phòng (hq-*, id phiên Claude Code hoặc omp-…), hoặc null" };
  if ("on" in r && typeof r.on !== "boolean") return { ok: false, error: "on: true hoặc false" };
  const room = "room" in r ? (r.room as string | null) : base.room;
  const on = room === null ? false : "on" in r ? (r.on as boolean) : base.on;
  if (r.on === true && room === null) return { ok: false, error: "Chọn phòng Chief of Staff trước khi bật" };
  return { ok: true, value: { room, on } };
}

export function readChief(file = chiefFile()): ChiefConfig {
  try {
    const n = normChief(JSON.parse(fs.readFileSync(file, "utf8")));
    return n.ok ? n.value : { ...CHIEF_DEFAULT };
  } catch {
    return { ...CHIEF_DEFAULT };
  }
}

export function writeChief(cfg: ChiefConfig, file = chiefFile()): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** The installed hq-control script (8sync deploys bundled skills to ~/.omp/skills): forward slashes, so bash and PowerShell both run it. */
export function hqScript(home = os.homedir()): string {
  return path.join(home, ".omp", "skills", "hq-control", "scripts", "hq.mjs").replace(/\\/g, "/");
}

const one = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/[\s|]+/g, " ").trim();
  return [...t].length > n ? `${[...t].slice(0, n - 1).join("")}…` : t;
};

/** One line per room the chief can hand work to: `- <id> · <label> · <project> · <status> · <doing>` (the chief itself left out). */
export function rosterTable(rooms: readonly Brief[], chief: string | null): string {
  const rows = rooms
    .filter((b) => b.id !== chief && b.session_id !== chief)
    .map((b) => `- ${b.id} · ${one(b.label, 40)} · ${one(b.project?.name ?? null, 40) || "-"} · ${b.status}${b.waiting ? " (đang chờ owner)" : ""} · ${one(b.doing, 80) || "-"}`);
  return rows.length ? rows.join("\n") : "(không có phòng nào khác đang mở)";
}

/** What the chief room gets: the owner's words, the live rooms, then how to work. Fits `max` chars (the room list is cut first). */
export function chiefPrompt(text: string, rooms: readonly Brief[], chief: string, script = hqScript(), max = 4000): string {
  const rule = `Bạn là Chief of Staff: chia việc cho đúng phòng bằng \`node ${script} send <room> …\`, theo dõi, kiểm kết quả, chỉ báo owner khi cần quyết. Trước khi giao: \`node ${script} brief <room>\`.`;
  const head = `${text.trim()}\n\nCác phòng đang mở (id · tên · dự án · trạng thái · đang làm):\n`;
  let table = rosterTable(rooms, chief);
  const room = max - [...head].length - [...rule].length - 2;
  if ([...table].length > room) {
    const lines = table.split("\n");
    while (lines.length > 1 && [...lines.join("\n")].length > room - 40) lines.pop();
    table = `${lines.join("\n")}\n… (đủ danh sách: node ${script} roster)`;
  }
  return `${head}${table}\n\n${rule}`;
}

/** What `ask` needs from the outside (the route passes the live ones, a test its fakes). */
export type ChiefDeps = {
  cfg: ChiefConfig;
  roster: () => Promise<Brief[]>;
  send: (room: string, text: string) => Promise<unknown>;
  script?: string;
};

export type ChiefAsk = { status: 201; room: string; result: unknown } | { status: 409 | 422; error: string };

/** The owner's part of a chief message: the room list and the rule fill the rest of the 4 000 a message may hold. */
export const CHIEF_TEXT_MAX = 2500;

/** The owner's `text` to the chief room, with the room list and the rule. Never sends while the chief is off or not live. */
export async function chiefAsk(text: string, d: ChiefDeps): Promise<ChiefAsk> {
  const body = text.trim();
  if (!body) return { status: 422, error: "text: cần nội dung" };
  if ([...body].length > CHIEF_TEXT_MAX) return { status: 422, error: `text: tối đa ${CHIEF_TEXT_MAX} ký tự (HQ còn ghép danh sách phòng vào sau)` };
  if (!d.cfg.on || !d.cfg.room) return { status: 409, error: "Chief of Staff đang tắt: chọn phòng và bật ở tab Máy" };
  const rooms = await d.roster();
  const chief = rooms.find((b) => b.id === d.cfg.room || b.session_id === d.cfg.room);
  if (!chief) return { status: 409, error: "Phòng Chief of Staff không còn mở: chọn phòng khác ở tab Máy" };
  return { status: 201, room: chief.id, result: await d.send(chief.id, chiefPrompt(body, rooms, chief.id, d.script)) };
}
