# team-board — one command opens the whole team headless, cards flow through super-board lanes

Owner (2026-10-17): "nó phải mở sẵn session và 100% headless all session cần mở chứ chỉ list các
session ra tôi lên web xem làm được tới đâu … suy nghĩ kĩ mỗi session - phòng ban tên gì rd, dev,
qc, ba … update lại cách sài bên github pages và readme.md … cần apply 100% của
https://github.com/EricTechPro/super-board".

Today `auto on --here --loop` only queues a loop message into rooms the owner already opened one by
one; the target queue is a flat list every room works on at once.

## Design (native Rust, local files, no GitHub Projects)
- `8sync ccc auto up [--roles lead,dev,qa,review] [--loop 10m] [--hours N] [--usd-per-hour X]`:
  `auto on --here`, then every missing role room starts as a Claude Code background session
  (`claude --bg --name <room> --model <role model> --permission-mode auto "<loop prompt>"`,
  Claude Code 2.1.296: prints `backgrounded · <8-char id> · <name>`). Live rooms (`claude agents
  --json --cwd <root>`) only get the loop message; a stopped room with a transcript resumes with
  `--resume <id> --bg`. The registry is rebound to the id Claude Code picked (`--session-id` is
  ignored with `--bg`). "Workspace not trusted" → stop, tell the owner to open `claude` there once.
  `auto down` stops this project's background rooms and pauses auto. Watch: `8sync hq ui`.
- Rooms (name → role → model): lead (Lead/PM, opus) · ba (BA, opus) · rd (R&D, opus) ·
  dev (Dev/Builder, sonnet) · qa/qc (QA, haiku) · review (Review, sonnet). Default team
  lead,dev,qa,review; `dev2` is a second builder.
- Board (super-board lanes on `targets.json`): backlog → ready → building → qa → review → done,
  plus blocked. `add` without `--check` lands in backlog (needs AC + check before ready), with
  `--check` in ready; label `qa` skips building. `claim` takes the first unclaimed card of the
  room's lane (a claim older than 2 h is reaped, a stranded building card goes back to ready),
  `move` validates the transition, a third bounce to ready blocks the card (rebuild cap 2).
  Same-text `add` of an open card adds a "seen again" note instead of a duplicate. `board`, `lint`.
- Merge stays outside 8sync: the review room approves a head SHA; merging is a plain
  `gh pr merge --squash --match-head-commit <sha>` after the owner's Ship, so the guard sees it.

## Criteria
| # | Criterion | Check |
|---|---|---|
| C1 | Room names map to roles and models (dev, ba, qc → QA) | `cargo test -q -j2 -p su-code --bin 8sync ccc::room` |
| C2 | `auto up` builds the right claude argv per room, skips live rooms, resumes stopped ones, rebinds the registry, stops on an untrusted workspace | `cargo test -q -j2 -p su-code --bin 8sync ccc::team` |
| C3 | Registry rebind keeps name, goal and urgency | `cargo test -q -j2 -p ccc-core registry` |
| C4 | Board: lanes, claim/reap, move rules, rebuild cap, dedupe, lint, legacy targets read as ready | `cargo test -q -j2 -p su-code --bin 8sync ccc::target` |
| C5 | Existing auto/idle/room tests still pass | `cargo test -q -j2 -p su-code --bin 8sync ccc::` |
| C6 | HQ shows the board lanes | `pnpm --dir apps/hq-ui exec vitest run` |
| C7 | CI green on Windows, macOS, Linux | `gh pr checks <pr> --watch` |

Release: yes (owner pre-approved: "all proceed 100% yes … urgently").
