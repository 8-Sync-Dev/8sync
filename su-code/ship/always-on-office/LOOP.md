# LOOP always-on-office

| C | lệnh |
|---|---|
| C1 | `nice -n 19 cargo test -p su-code -j2 -- ccc::idle` |
| C2 | `nice -n 19 cargo test -p su-code -j2 -- ccc::delegate` |
| C3 | `nice -n 19 cargo test -p su-code -j2 -- ccc::room` |
| C4 | `cd apps/hq-ui && pnpm vitest run tests/office.test.ts tests/sprite.test.ts && pnpm typecheck` |
| C5 | `bash su-code/ship/hq-office-rooms/uat.sh` |
| C6 | `test $(grep -c https:// su-code/research/2026-10-15-always-on.md) -ge 6` |
| C7 | `gh pr checks <n>` |

## Evidence
iter 0 | C2 | exit 0 | Running unittests src\main.rs (target\debug\deps\8sync-7d349a428a891e04.exe)
iter 0 | C1 | exit 0 | Running unittests src\main.rs (target\debug\deps\8sync-7d349a428a891e04.exe)
iter 0 | C2 | exit 0 | Running unittests src\main.rs (target\debug\deps\8sync-7d349a428a891e04.exe)
iter 0 | C3 | exit 0 | Running unittests src\main.rs (target\debug\deps\8sync-7d349a428a891e04.exe)
iter 0 | C6 | exit 0 | (no output)
iter 0 | C4 | exit 0 | > tsc --noEmit
iter 0 | C5 | exit 0 | UAT PASS
