# hq-ui-port — `pnpm dev` / `pnpm start` of apps/hq-ui work on Windows

Source: `su-code/STATE.md` → Next ("apps/hq-ui `start` script uses POSIX `${PORT:-…}`"), picked by
`/autopilot` (owner, 2026-10-27, "auto check"). Org rule: every build runs on Windows, macOS and Linux.

## Problem
`package.json` scripts were `next dev|start -H 127.0.0.1 -p ${PORT:-${HQ_UI_PORT:-8740}}`. pnpm runs
scripts through `cmd.exe` on Windows (no `shell-emulator` in this repo), so `next` got the literal text
`${PORT:-${HQ_UI_PORT:-8740}}` as its port and refused to start. The release asset is not affected (it
runs `node server.js`); dev on Windows is.

## Design
- `apps/hq-ui/scripts/next.mjs <dev|start>`: port = `PORT`, else `HQ_UI_PORT`, else 8740 (an empty value
  counts as unset, like `${VAR:-}`); host always 127.0.0.1; spawns Next's own bin with `process.execPath`
  (no shell on any OS), forwards stdio, exit code and Ctrl+C. An invalid port is a clear error, not a
  silent fallback.
- `package.json`: `"dev": "node scripts/next.mjs dev"`, `"start": "node scripts/next.mjs start"`.
- Out of scope: `build` (`eslint && next build` works in cmd.exe and sh), the release `server.js`.

## Acceptance criteria (each one command, exit 0 = pass)
| # | Criterion | Command |
|---|---|---|
| C1 | port rules (PORT > HQ_UI_PORT > 8740, empty = unset, invalid refused), argv, no `${` left in any script | `pnpm exec vitest run tests/next-port.test.ts` (in apps/hq-ui) |
| C2 | Windows UAT: `pnpm dev` with `HQ_UI_PORT=8791` answers HTTP on 127.0.0.1:8791, tree stopped after | `node su-code/ship/hq-ui-port/uat-dev.mjs` |
| C3 | typecheck + whole hq-ui test suite | `pnpm exec tsc --noEmit && pnpm exec vitest run` (in apps/hq-ui) |
| C4 | CI green on ubuntu, macos, windows (PR checks) | `gh pr checks <pr>` |
