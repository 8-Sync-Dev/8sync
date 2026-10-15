# LOOP — autowork-speed

| # | Lệnh |
|---|---|
| C1 | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code learn_` |
| C2 | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code skill_learn` |
| C3 | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/schedule.test.ts` |
| C4 | `cd apps/hq-ui && nice -n 19 pnpm exec vitest run tests/sprite.test.ts tests/office.test.ts tests/floor.test.ts` |
| C5 | `bash scripts/uat/hook-latency.sh` |
| C6 | `cd apps/hq-ui && nice -n 19 pnpm exec tsc --noEmit && nice -n 19 pnpm exec eslint` |
| C7 | `! (nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code --all-targets 2>&1 | grep -E 'crates/cli/src/(verbs/learn.rs|verbs/skill/learn.rs|verbs/skill/mod.rs|main.rs|verbs/mod.rs)')` |
| C8 | CI on feat/autowork-speed: `gh run watch <id> --exit-status` |

## Evidence

iter 0 | C1 | exit 0 | = note: `#[warn(unused_imports)]` (part of `#[warn(unused)]`) on by default
iter 0 | C2 | exit 0 | = note: `#[warn(unused_imports)]` (part of `#[warn(unused)]`) on by default
iter 0 | C3 | exit 0 | Duration  189ms (setup 27%, transform 21%, import 20%, tests 20%, worker 13%)
iter 0 | C5 | exit 0 | PASS *** (7 runs each)
iter 0 | C7 | exit 0 | (no output)
iter 0 | C4 | exit 0 | Duration  342ms (tests 49%, transform 29%, import 15%, setup 4%, worker 3%)
iter 0 | C6 | exit 0 | (no output)
iter 0 | C7 | exit 0 | (no output)
