// The read-only view of an omp room whose session is open in another terminal on the PC (owner
// 2026-10-21 "vẫn chưa vô xem được omp đang làm gì"): its "Nhật ký" events (lib/server/activity.ts,
// secrets masked, shell commands shown by intent) written into the drawer's xterm as plain lines.
import type { ActivityEvent } from "@/lib/server/activity";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const OFF = "\x1b[0m";
const MARK: Record<NonNullable<ActivityEvent["status"]>, string> = { pending: "…", ok: "✓", error: `${RED}✗` };

/** Transcript text as terminal text: no control bytes (an escape in a reply must not drive the terminal), `\n` → CRLF. */
function clean(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "").replace(/\n/g, "\r\n");
}

function hhmm(at: number | null): string {
  if (at == null) return "     ";
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The whole screen: oldest first, newest at the bottom (as Nhật ký), from a cleared terminal. */
export function activityScreen(events: ActivityEvent[]): string {
  const head = `\x1b[2J\x1b[3J\x1b[H${DIM}— Đang xem (chỉ đọc) nhật ký của phiên, cập nhật mỗi 2 giây —${OFF}\r\n\r\n`;
  if (!events.length) return `${head}${DIM}Chưa có gì trong nhật ký của phiên này.${OFF}\r\n`;
  const lines = events.map((ev) => {
    const time = `${DIM}${hhmm(ev.at)}${OFF} `;
    const text = clean(ev.text);
    if (ev.kind === "prompt") return `${time}${BOLD}${CYAN}›${OFF} ${BOLD}${text}${OFF}`;
    if (ev.kind === "text") return `${time}${text}`;
    if (ev.kind === "agent") return `${time}${DIM}⇢ subagent ${clean(ev.tool ?? "")}${text ? `: ${text}` : ""}${OFF}`;
    const mark = MARK[ev.status ?? "pending"];
    const err = ev.error ? ` — ${clean(ev.error)}` : "";
    return `${time}${DIM}${mark} ${clean(ev.tool ?? "tool")}${text ? `: ${text}` : ""}${err}${OFF}`;
  });
  return `${head}${lines.join("\r\n")}\r\n`;
}
