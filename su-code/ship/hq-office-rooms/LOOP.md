# LOOP — hq-office-rooms

| # | Lệnh |
|---|---|
| C1 | `nice -n 19 cargo test -q -j2 subagent` |
| C2 | `nice -n 19 cargo test -q -j2 inbox` |
| C3 | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run` |
| C4 | `cd apps/hq-ui && pnpm exec next typegen && nice -n 19 pnpm exec tsc --noEmit` |
| C5 | `cd apps/hq-ui && nice -n 19 pnpm exec eslint` |
| C6 | `bash scripts/hq-offline-check.sh` |
| C7 | CI on feat/hq-office-rooms: `gh run watch <id> --exit-status` |
| C9 | `nice -n 19 cargo test -q -j2 usage_` |
| C10 | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/office.test.ts tests/labels.test.ts` |
| C11 | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/isolation.test.ts` |
| C8 | `bash su-code/ship/hq-office-rooms/uat.sh` |

## Evidence

iter 0 (baseline) | vitest run (Windows) | exit 1 | 5 pre-existing Windows-only failures: auth 0600 mode, channel path sep x2, channel long-poll timeout, ingest hq_session alias; CI (linux) green on main bab89a2
iter 0 | found: vitest on Windows wrote into the REAL ~/.local/state/8sync/hq (os.homedir reads USERPROFILE; helpers set HOME only) — journal rotated/overwritten (2790 B -> 657 B), junk projects/session rows. Fixed (setup.ts + helpers set both) and cleaned DB rows (projects 2, sessions 1); real journal mtime unchanged after a full run.
iter 1 | cargo test -j2 subagent | exit 0 | test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 400 filtered out; finished in 0.00s
iter 1 | cargo test -j2 inbox | exit 0 | test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 400 filtered out; finished in 0.01s
iter 1 | cargo test -j2 usage_ | exit 0 | test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 398 filtered out; finished in 0.01s
iter 1 | note | session ended 00:12, resumed 05:44 on owner 'continue'; wall clock 343 min was idle time, loop timer re-initialised (iter count carried: next = iter 2)
iter 2 | C10 vitest office+labels | exit 0 |       Tests  19 passed (19)
iter 2 | C11 vitest isolation | exit 0 |       Tests  1 passed (1)
iter 2 | C4 tsc --noEmit | exit 0 | clean
iter 2 | live /api/office | ok | 3 rooms; project+branch su-code feat/hq-office-rooms, content-post-agency win-dev; delivery inbox; tokens from ls; usage null (installed 0.79.1 statusline predates snapshots)
iter 3 | office UI built: OfficeView (rooms per project + branch, 7-seat template, walker visits, usage footer), Chat nhóm / Chat phòng split, Báo cáo tab (+ /ship-loop list), nav grouped by git folder + branch, scope by name/session id/label
iter 3 | C4 tsc --noEmit | exit 0 | clean
iter 3 | C5 eslint | exit 0 | clean
iter 3 | C10 vitest office+labels+isolation | exit 0 | Tests 26 passed (26) (+ seat state, matchesSession, totals, loops, walker)
iter 3 | C3 vitest full (Windows) | exit 1 | 246 passed, 3 failed = the Windows-only baseline (auth 0600, channel path sep x2); real journal size unchanged before/after (2899 B)
iter 3 | C9 cargo test report/usage/inbox/subagent/stop/dispatcher | exit 0 | 11 passed; $/task total now over measured sessions only (Rust + TS agree)
iter 3 | C6 hq-offline-check.sh | exit 0 | hq-offline-check: OK
iter 3 | C8 UAT live (5 real sessions, Edge headless) | PASS 7/7 | found + fixed: tab bar overflow 170 px at 390 px; header said "0 projects" (now "N dự án · M phòng")
iter 3 | C8 UAT seeded (uat.sh, isolated HOME) | PASS 15/15 | found + fixed: Board and Giao việc only offered tmux sessions ("Start a session to hand it tasks" with sessions running) -> tasks to inbox sessions (/api/tasks accepts a session id)
iter 3 | C7 CI run 38483582880 on feat/hq-office-rooms (85c3010) | exit 0 | all jobs green (test ubuntu, minimal, hq-ui-test)
