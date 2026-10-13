# LOOP — hq-web-team
| AC | check |
|---|---|
| AC1 | vitest tests/roles.test.ts |
| AC2 | vitest tests/assign.test.ts |
| AC3 | vitest tests/terminal-api.test.ts |
| AC4 | vitest tests/team-thread.test.ts |
| AC5 | vitest tests/floor.test.ts tests/sprite.test.ts |
| AC6 | grep guide + docs |
| AC7 | scripts/hq-offline-check.sh + gitleaks |
| AC8 | tsc + vitest all (+ CI) |

## Evidence
iter 1 | AC1 | pnpm exec vitest run tests/roles.test.ts | exit 0 |       Tests  5 passed (5)
iter 1 | AC2 | pnpm exec vitest run tests/assign.test.ts | exit 0 |       Tests  9 passed (9)
iter 1 | AC3 | pnpm exec vitest run tests/terminal-api.test.ts | exit 0 |       Tests  4 passed (4)
iter 1 | AC4 | pnpm exec vitest run tests/team-thread.test.ts | exit 0 |       Tests  5 passed (5)
iter 1 | AC5 | pnpm exec vitest run tests/floor.test.ts tests/sprite.test.ts | exit 0 |       Tests  45 passed (45)
iter 1 | AC6 | bash -c grep -q "Giao việc" components/hq/guide.tsx && grep -q "Giao việc" ../../docs/hq.md && echo OK | exit 0 | OK
iter 1 | AC7 | bash ../../scripts/hq-offline-check.sh | exit 0 | hq-offline-check: OK
iter 1 | AC7 | gitleaks detect --no-git --source . --redact --no-banner | exit 0 | 8:00PM INF no leaks found
iter 1 | AC8 | bash -c pnpm exec tsc --noEmit && pnpm exec vitest run | exit 0 |       Tests  227 passed (227)
iter 2 | AC1-AC8 | vitest run (all) | exit 0 | Tests 228 passed (228); tsc --noEmit exit 0; eslint clean
iter 2 | AC2/AC3 UAT | Firefox BiDi on next dev :8742 | ok | "Giao việc" role Fullstack → POST /api/tasks 201, tmux hq-fullstack-1 argv `claude --model claude-sonnet-5-5 … -- New task: …`; drawer showed live pane (trust dialog) + keys bar (shots in ~/.cache/8sync-uat/shots/web-team/e*.png)
iter 2 | fix | cargo test -p su-code journal_maps_each_event | exit 0 | uuid sender kept (was "***")
iter 2 | UAT finding fixed | assign 409 with a deleted project folder showed no error | inline alert + missing projects hidden
## Brief (iteration 2, all criteria green locally)
- AC1–AC7 green with evidence above; AC8 local green, CI pending on the pushed branch.
- Not verified: next build (CI package-hq-ui), handoff bubble with a live session_message, Channels mode.
- Next: CI on PR, then one Ship question for release + install.
iter 2 | AC8 | gh pr checks 22 | exit 0 | test macos/ubuntu/windows, minimal, hq-ui-test, package-hq-ui all SUCCESS — all criteria green
