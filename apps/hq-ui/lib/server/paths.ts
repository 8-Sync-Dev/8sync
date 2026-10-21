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
/** HMAC key for "Chơi thử" cookies and demo links (lib/server/play.ts): its own random secret, never the UI token. */
export const playSecretPath = () => path.join(configDir(), "play-secret");

export const channelMcpConfigPath = (home = os.homedir()) =>
  path.join(home, ".config", "8sync", "hq", "channel-mcp.json");

/** `8sync ccc hook idle` status files, one per team member (crates/cli/src/verbs/ccc/idle.rs state_dir). */
export const idleStatusDir = (home = os.homedir()) => path.join(home, ".local", "state", "8sync", "ccc", "idle", "status");
/** The roots `auto up` brought a team up in, `auto down` drops (crates/cli/src/verbs/ccc/team.rs team_roots_file). */
export const teamRootsPath = (home = os.homedir()) => path.join(home, ".local", "state", "8sync", "ccc", "idle", "team-roots.json");
/** Projects the owner pinned (`8sync ccc auto pin`): `{ "<root>": <pinned at, unix s> }` (crates/cli/src/verbs/ccc/lease.rs pins_file). */
export const pinnedRootsPath = (home = os.homedir()) => path.join(home, ".local", "state", "8sync", "ccc", "idle", "pinned-roots.json");

/**
 * `<platform data dir>/8sync/hq-play`: the "Chơi thử" worktrees, one per project, outside every repo
 * (so Preview never scans them). Same base as `8sync hq ui`'s own install (crates/cli/src/verbs/hq.rs
 * `hq_ui_data_dir`, Rust `dirs::data_dir()`): %APPDATA% on Windows, ~/Library/Application Support on
 * macOS, $XDG_DATA_HOME or ~/.local/share elsewhere.
 */
export function playRootDir(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  const base =
    platform === "win32"
      ? env.APPDATA || path.join(home, "AppData", "Roaming")
      : platform === "darwin"
        ? path.join(home, "Library", "Application Support")
        : env.XDG_DATA_HOME && path.isAbsolute(env.XDG_DATA_HOME)
          ? env.XDG_DATA_HOME
          : path.join(home, ".local", "share");
  return path.join(base, "8sync", "hq-play");
}
