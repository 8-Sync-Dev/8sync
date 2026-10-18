// Client-side mirrors of the API rows (lib/server/*). Kept small on purpose.
export type Project = {
  id: number;
  path: string;
  name: string;
  added_at: number;
  /** The folder no longer exists on disk (set by GET /api/projects). */
  missing?: boolean;
};

export type SessionStatus = "running" | "idle" | "needs_input" | "ended";

export type Session = {
  name: string;
  label: string;
  session_id: string | null;
  project_id: number | null;
  status: SessionStatus;
  started_at: number | null;
  cwd: string | null;
  tmux: boolean;
  source: "tmux" | "claude" | "journal" | "omp";
  detail: string | null;
  /** Inbox delivery: the 8sync-inbox mod is loaded and polling, so a task enters as soon as the session is idle. */
  inbox_live?: boolean;
  channel: boolean;
  channel_beat_at: number | null;
  /** Sticky delivery facts: org policy drops channel events, or the channel went silent. */
  channel_state: "blocked-by-org" | "unresponsive" | null;
  /** A Claude Code dialog open in the pane ("Trust this folder?"), or null. */
  waiting: string | null;
  /** Team role (lib/roles.ts) and model id, set when HQ started the session with one. */
  role?: string | null;
  model?: string | null;
  /** Team: absent = Claude Code (Đội ccc); "omp" for omp rooms (reached through their inbox). */
  engine?: string;
};

export type Task = {
  id: number;
  session: string | null;
  task_id: string;
  subject: string;
  role: string | null;
  prio: string | null;
  status: string;
  updated_at: number;
};

export type Message = {
  id: number;
  ts: number;
  session: string | null;
  team: string | null;
  kind: string;
  from_: string | null;
  to_: string | null;
  text: string | null;
  delivery?: string | null;
};

export type ChannelMode = { mode: "channel" | "off"; reason: string | null };

export const TASK_COLUMNS = [
  { key: "todo", label: "To do" },
  { key: "doing", label: "Doing" },
  { key: "review", label: "Review" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" },
] as const;
