# DECISIONS (8sync managed — append-only)

## 2026-08-08 — multi-session (named per-project sessions)
- **Build ON omp's session core, don't reinvent it** (user directive: "core base từ omp có sẵn hết
  rồi chỉ viết để extends"). omp owns transcript storage + `--continue`/`--resume`; 8sync adds only
  the 3 things omp lacks: a human **name → `--session-dir`** map, **git worktree** isolation, and
  **merge**. Registry (`~/.config/8sync/sessions/<repo>/index.json`) stores nothing omp already has.
- **One `--session-dir` per name** beats tracking omp session UUIDs — omp's own `--continue` then
  resumes the right conversation with zero bookkeeping.
- **Merge = real git branch integration**, adopted wholesale from affaan-m/ECC (MIT): `git
  merge-tree --write-tree` read-only preflight → `git merge --no-edit` → rebase-to-unblock → cleanup.
  ALL via `git` CLI shell-out (which is how ECC does it too) → zero new deps. ECC's
  rusqlite/git2/tokio/ratatui stack REJECTED (busts the 5 MiB budget). NOT context/history merge.
- **CLI namespaced under `8sync .`** (not new top-level `new/rm/merge` verbs): verb count is already
  26 vs the ≤22 target, and a top-level `8sync rm` is a dangerously generic name.
- **prompt-optimizer (AGPL-3.0) and TypeScript-7/tsgo evaluated and NOT integrated** — the first
  optimizes human prose (wrong layer) + is license-incompatible; the second is transparent to
  `8sync run` (delegates to package.json), no code change.

## 2026-10-17 — team up + super-board lanes (v0.100)

- **`auto up` = `claude --bg` per role room**, not a tmux/terminal per room and not `claude -p`:
  background sessions keep the conversation, take a loop via the inbox, show in `claude agents` and
  `8sync hq ui`, and resume under the same id. `--bg` ignores `--session-id`, so the registry is
  rebound to the id Claude Code picked (`Store::rebind`).
- **`--clear-ss` deletes only background sessions of the project no room keeps** (`claude rm`, which
  refuses a worktree with unpushed commits). Interactive sessions are never touched: they are the
  owner's terminals.
- **super-board lanes rebuilt in Rust on the local `targets.json`**, not GitHub Projects: no token,
  no network, works offline and on every OS; HQ reads `auto board --json`. super-collect (scraping
  sources into cards) skipped: no source the owner named, and it would collect external data.
- **No merge verb in 8sync.** A verb would let a loop merge around the guard's Ship grant. Review
  approves the head SHA (`move approved --sha`), the owner answers Ship, the lead runs plain
  `gh pr merge --squash --match-head-commit <sha>` that the guard already gates.
- **Auto-compact: 65 % of the model window** (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`, capped by
  Claude Code at the model window) replaces 60 % × 400K, which compacted 1M sessions at ~24 %.
