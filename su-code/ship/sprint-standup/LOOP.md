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
iter 1 | C6 | exit 0 | test (windows-latest)	pass	***	https://github.com/8-Sync-Dev/su-code/actions/runs/38676003083/job/116229632688

## Brief (all green, 2026-10-15)
C1–C5 green locally (iter 1), C6 PR #36 CI run 38676003083 green on ubuntu/macos/windows + hq-ui-test, minimal, package-hq-ui.
Reviewer 6 SHOULD + critic FATAL/5 MAJOR fixed before commit e5eea2d. Not verified: UAT shell scripts on Windows/macOS; CLAUDE_CODE_SESSION_ID on Windows/macOS; /sprint effect on delegation ratio (re-run q3_measure.py after a week).
