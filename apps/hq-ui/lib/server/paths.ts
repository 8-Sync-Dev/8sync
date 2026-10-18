import os from "node:os";
import path from "node:path";

// Resolved per call so tests (and the smoke run) can point HOME elsewhere.
export function stateDir(): string {
  return path.join(os.homedir(), ".local", "state", "8sync", "hq");
}

export function configDir(): string {
  return path.join(os.homedir(), ".config", "8sync", "hq");
}

export const journalFiles = () => ({
  current: path.join(stateDir(), "events.jsonl"),
  rotated: path.join(stateDir(), "events.1.jsonl"),
});

export const dbPath = () => path.join(stateDir(), "hq.db");
export const tokenPath = () => path.join(configDir(), "ui-token");
/** `8sync hq ui --public` writes the tunnel host + login key here (contract C6); absent = local only. */
export const publicPath = () => path.join(configDir(), "public.json");
/** AskUserQuestion / permission requests the kit hook is waiting on (contract C5). */
export const pendingDir = () => path.join(stateDir(), "pending");

export const channelMcpConfigPath = (home = os.homedir()) =>
  path.join(home, ".config", "8sync", "hq", "channel-mcp.json");

/** `8sync ccc hook idle` status files, one per team member (crates/cli/src/verbs/ccc/idle.rs state_dir). */
export const idleStatusDir = (home = os.homedir()) => path.join(home, ".local", "state", "8sync", "ccc", "idle", "status");
