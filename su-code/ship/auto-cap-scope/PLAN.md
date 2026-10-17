# auto-cap-scope — the auto loop rests for the right reason

Owner (2026-10-17, ai-game-studio, `8sync ccc auto on --here --loop 2m --team`): every room skipped
its tick with "spending is over the cap: $6.72 in the last hour against a $5/hour limit" while T3–T9
were still open and the status line showed 5h 23%. "đây nó bị dừng là sai phải không".

Root cause (crates/cli/src/verbs/ccc/idle.rs):
1. `costs(home)` sums every session's status-line snapshot on the machine. `--here` limits which
   rooms auto drives, not whose spend counts: this su-code session and rooms of other projects ate
   the ai-game-studio budget.
2. On a subscription login `cost.total_cost_usd` is an API-price estimate, not a bill. The real
   limit is the 5-hour / 7-day usage window (`rate_limits`, already in the snapshot). A $5/hour
   default rests a 3-room Opus team at 23% of the window.

Fix (smallest that matches the intent; old leases keep their stored $ rate until `auto on` again):
- Spend counts only sessions whose cwd is inside the `--here` root (all sessions without `--here`).
- Subscription without `--usd-per-hour`: rest when the newest 5-hour or 7-day reading is ≥ 90%
  (the rest stays for the owner); no $ rail. With `--usd-per-hour`: both rails. No window reading
  at all: fall back to the $5 default (fail safe).
- API key: unchanged ($5/hour default).

## Criteria
| # | Criterion | Check |
|---|---|---|
| C1 | Spend under `--here` ignores sessions outside the project | `cargo test -q -j2 -p su-code --bin 8sync ccc::idle::tests::spend_counts_only_this_project` |
| C2 | Subscription: window rail at 90%, no $ rail unless set; stale reading ignored; no reading → $ default | `cargo test -q -j2 -p su-code --bin 8sync ccc::idle::tests::subscription_rests_on_the_usage_window` |
| C3 | Existing idle + auto tests still pass | `cargo test -q -j2 -p su-code --bin 8sync ccc::idle ccc::auto` |
| C4 | CI green on Windows, macOS, Linux | `gh pr checks <pr> --watch` |

Release: no (autopilot batch; owner Ship).
