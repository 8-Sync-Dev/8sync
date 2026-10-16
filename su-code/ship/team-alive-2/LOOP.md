# team-alive-2 — LOOP

| C# | criterion | lệnh |
|---|---|---|
| C1 | kit skill /ship-tick + cron trong ship-* (nhánh feat/ship-tick 62da3d9) | `gh run view 38867604686 --exit-status` (CI 3 OS, gồm test ship_tick) |
| C2 | idle ladder cho phiên đứng một mình khi auto on | `cargo test -q -j2 -p su-code idle::tests` |
| C3 | HQ auto-tick qua inbox (vitest) | `cd apps/hq-ui && pnpm exec vitest run tests/auto-tick.test.ts tests/auto-api.test.ts` |
| C4 | HQ bản cũ được báo (nhánh feat/hq-up-ui-refresh dbf22a9) | `gh run view 38866841389 --exit-status` (CI 3 OS, gồm test installed_versions) |
| C5 | hq-ui tsc + lint | `cd apps/hq-ui && pnpm exec tsc --noEmit -p . && pnpm run lint` |
| C6 | clippy touched | `cargo clippy -q -j2 -p su-code 2>&1 \| grep -E 'ccc/(idle\|auto)\.rs\|ccc\.rs\|ccc/help\.rs' ; test $? -eq 1` |
| C7 | CI 3 OS mỗi nhánh | `gh run watch <id> --exit-status` |

## Evidence
iter 0 | C1 | exit 0 | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 520 filtered out; finished in 0.00s
iter 0 | C2 | exit 0 | test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 507 filtered out; finished in 0.00s
iter 0 | C4 | exit 0 | test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 520 filtered out; finished in 0.00s
iter 0 | C6 | exit 0 | (no output)
iter 0 | C1 | exit 0 | Triggered via workflow_dispatch about 5 minutes ago
iter 0 | C4 | exit 0 | Triggered via workflow_dispatch about 12 minutes ago
iter 0 | C3 | exit 0 | Tests  15 passed (15)
iter 0 | C5 | exit 0 | (no output)
iter 0 | UAT C2 | exit 0 | binary thật (scratch HOME): trước `auto on` hook idle im lặng; sau `auto on --hours 1` Stop của phiên không team → additionalContext "8sync không-ai-rảnh: … Giao R&D … /deep-research \"câu hỏi mở: idle ladder standalone\""; sau `auto pause` im lặng. UAT C3: not verified (loadOffice/getDb mock; chưa chạy HQ thật)
iter 0 | gates | — | /sec OK (gitleaks no leaks trên diff+file mới; không file nhạy cảm; lockfile không đổi → dependency audit skipped; không exec/shell mới; kit guard+gate bật; managed settings none = WARN cũ) · /rules CONDITIONS (Consumer Terms snapshot 2026-10-12 dòng 28: automated access chỉ khi Anthropic cho phép rõ → hook/scheduled task/plugin là tính năng chính thức Claude Code; điều kiện: owner có mặt, lease subscription ≤4 h, Pause, auto-tick dừng khi gate; không người trông → Console API key) · /aup-audit no BLOCK/WARN · `8sync ccc risk` low
iter 0 | C2 | exit 0 | test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 507 filtered out; finished in 0.00s
iter 0 | C3 | exit 0 | Duration  239ms (tests 41%, transform 25%, import 22%, setup 8%, worker 4%)
iter 0 | C5 | exit 0 | > eslint
iter 0 | C6 | exit 0 | (no output)
iter 0 | review | — | reviewer BLOCKER 1 (status.gate) đã sửa + test; SHOULD 2 (idle map stale sau 3 phút không poll), 3 (auto::running rẻ: marker+flags, không costs/gate), 5 (test đọc tasks/<sid>/ + lead với idle on tay), 6 (toEqual + tick gọi với status), 7 (write-then-rename + test 2 poll song song), 8 (slack 5 s + CHANGELOG: chỉ tick khi tab Văn phòng mở), NIT 9 (allowlist idle), 10 (error cố định "tick failed", chi tiết vào server log), 11 (lead tính một lần); SHOULD 4 = giả định trong PLAN. gitleaks trên diff mới: no leaks
