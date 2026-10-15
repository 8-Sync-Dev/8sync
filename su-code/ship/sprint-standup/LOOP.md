# LOOP: sprint-standup
| C | command |
|---|---|
| C1 | nice -n 19 ionice -c3 cargo test -p su-code -j2 -- standup urgent room |
| C2 | nice -n 19 ionice -c3 cargo test -p su-code -j2 -- kit |
| C3 | bash scripts/uat/sprint-skills.sh |
| C4 | bash scripts/uat/sprint-standup.sh target/debug/8sync |
| C5 | bash scripts/uat/session-goal.sh target/debug/8sync |
| C6 | gh pr checks <pr> --watch |

## Evidence
iter 0 | C3 | exit 1 | SOME FAILED
iter 0 | C3 | exit 0 | ALL PASS
iter 0 | C4 | exit 0 | ALL PASS
iter 0 | C5 | exit 1 | SOME FAILED
iter 0 | C5 | exit 0 | ALL PASS
iter 1 | C1 | exit 0 | Running unittests src/main.rs (***)
iter 1 | C2 | exit 0 | Running unittests src/main.rs (***)
iter 1 | C1 | exit 0 | Running unittests src/main.rs (***)
iter 1 | C2 | exit 0 | Running unittests src/main.rs (***)
iter 1 | C3 | exit 0 | ALL PASS
iter 1 | C4 | exit 0 | ALL PASS
iter 1 | C5 | exit 0 | ALL PASS
