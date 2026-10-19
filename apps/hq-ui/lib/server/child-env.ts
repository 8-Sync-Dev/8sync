// What a child of the HQ server (8sync, claude, tmux) gets to see. The HQ's own launch settings stay
// here: `HQ_*` (the `--public` nonce, channel flags), and the Next server's `PORT`/`HOSTNAME`/`NODE_ENV`,
// which would otherwise leak into every room claude starts. Advisory hardening: same-user processes
// remain trusted.

type Env = Record<string, string | undefined>;

// A session identity inherited from whoever started HQ (a Claude Code or omp room) would make the
// owner's HQ actions (`auto add --now`) look like that room's words.
const DROP = ["PORT", "HOSTNAME", "NODE_ENV", "CLAUDE_CODE_SESSION_ID", "EIGHTSYNC_ROOM", "EIGHTSYNC_ROOM_ID"];

/** A copy of `env` without the HQ server's own settings. */
export function childEnv(env: Env = process.env): NodeJS.ProcessEnv {
  const out = {} as NodeJS.ProcessEnv; // Next types NODE_ENV as required; it is dropped on purpose
  for (const [k, v] of Object.entries(env)) {
    const key = k.toUpperCase(); // Windows env names are case-insensitive
    if (v === undefined || DROP.includes(key) || key.startsWith("HQ_")) continue;
    out[k] = v;
  }
  return out;
}

/** `8sync` runs the binary that started this HQ (`EIGHTSYNC_BIN`, contract C-E), not whatever PATH finds first. */
export function binFor(cmd: string, env: Env = process.env): string {
  return cmd === "8sync" ? env.EIGHTSYNC_BIN || "8sync" : cmd;
}
