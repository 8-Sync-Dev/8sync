# hq-team-alive — LOOP (max-iter 12 · max-min 150)

| # | Criterion | Lệnh |
|---|---|---|
| C1 | ccc auto | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code ccc::auto` |
| C2 | ccc meet | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code ccc::meet` |
| C3 | room block sprint/meet | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code ccc::room` |
| C4 | help/hint | `cargo test -q -j2 -p su-code help_` + `hint_` |
| C5 | hq-ui vitest+typecheck+eslint | see PLAN |
| C6 | UAT browser | `PW_DIR=<scratchpad>/pw PW_EXE=~/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell bash su-code/ship/hq-team-alive/uat.sh` |
| C7 | clippy touched | see PLAN |
| C8 | CI 3 OS | `gh run watch <id> --exit-status` |

## Evidence
iter 0 | C1 | exit 0 | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 0.00s
iter 0 | C2 | exit 0 | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 509 filtered out; finished in 0.00s
iter 0 | C3 | exit 0 | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 0.00s
iter 0 | C4 | exit 0 | test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 502 filtered out; finished in 0.05s
iter 0 | C7 | exit 0 | (no output)
iter 0 | C5 | exit 0 | TYPECHECK+LINT OK
iter 0 | C6 | exit 1 | nice: ‘pnpm’: No such file or directory
iter 0 | C6 | exit 1 | [?25h
iter 0 | C6 | exit 1 | UAT FAIL (3): two rooms (3) · every attending room says its lead went to the meeting · a seat with 2 running agents draws 2 sprites (1,1,1,1,1,1,1,1)
iter 0 | C5 | exit 0 | TYPECHECK+LINT OK
iter 0 | C6 | exit 1 | Node.js v24.18.0
iter 0 | C6 | exit 1 | Node.js v24.18.0
iter 0 | C6 | exit 1 | UAT FAIL (1): a seat with 2 running agents draws 2 sprites (1,1,1,1,1,1,1,1)
iter 0 | C6 | exit 0 | UAT PASS
iter 0 | C5 | exit 0 | TYPECHECK+LINT OK
iter 0 | C6 | exit 0 | UAT PASS

## Gates (iter 0, 2026-10-16 ~12:05 local)
- `/sec`: gitleaks (diff 21 KB, untracked uat/ 77 KB, lib+verbs 604 KB) no leaks; regex hit = placeholder fixture already on main (room.rs test); no sensitive files; kit guard/verify/stop gates on. Dependency audits WARN pre-existing (lockfiles unchanged): cargo audit RUSTSEC-2026-0190 anyhow 1.0.102 (downcast_mut unsoundness), pnpm audit GHSA-vfj7-8cjw-p6xm braces via shadcn dev chain. OWASP on new code: auto API token-protected (`open(req)`), action allow-list + fixed argv, 5 s timeout; meet cells through `standup::clean_cell` (pipes→"/", control chars, secrets, ≤100), fixed `su-code/standup/<UTC date>.md` path; readStandup fixed sub-path, ≤64 KB. → OK.
- `/rules`: CONDITIONS → allowed. Rules file 2026-10-11; Consumer Terms snapshot 2026-10-12 ("access through automated or non-human means" only via API key) satisfied: auto re-arms only while the owner's HQ tab is open, `idle::on` keeps lease ≤4 h + owner-present window (idle.rs:575/626), delegate answers the session's own question, Pause never auto-resumes, meet = local markdown, daily preset = text only. Not allowed: scheduling `auto on` headlessly on a subscription login → Console API key.
- `/aup-audit`: gitleaks history clean for touched files; no sensitive file in diff (history: assets/configs/kitty.session pre-existing, untouched); no RULES.md signal (keyword hits = LOOP.md prose, phone viewport). → no BLOCK/WARN.
- `8sync ccc risk`: low — only `/sec` mandatory for these file names (ran all three anyway per owner rule).
iter 0 | C1 | exit 0 | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 0.00s
iter 0 | C2 | exit 0 | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 0.00s
iter 0 | C3 | exit 0 | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 513 filtered out; finished in 0.00s
iter 0 | C4 | exit 0 | test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 504 filtered out; finished in 0.05s
iter 0 | C7 | exit 0 | clippy touched-files exit=1
iter 0 | C5 | exit 0 | TYPECHECK+LINT OK
iter 0 | C6 | exit 0 | UAT PASS

## Review (reviewer agent, 2026-10-16 ~12:10) → NOT MERGEABLE → fixed → re-checked
- BLOCKER 1 (HQ undid `cancel --all`/`idle off`/`delegate off` within 60 s; clobbered hand-set leases): `auto status` now derives `paused` from marker-on + flags-off, reports `manual` for flags-on without marker, `cancel --all` writes the paused marker (auto.rs `mark_paused`, cancel.rs), HQ auto-starts once per page load and never over `manual` (`shouldAutoStart(s, started)`). Tests: `hand_off_switch_counts_as_paused_and_hand_on_counts_as_manual`, cancel test asserts paused, auto-ui.test.
- SHOULD 2 (silent marker write): `write_marker` returns `Result` (test `marker_write_failure_is_an_error_not_a_silent_success`); `delegate::on` failure rolls `idle` back.
- SHOULD 3 (false "re-arms after lease expires"): comment + CHANGELOG corrected; `autoText` shows "Lease hết hạn — bấm Chạy liên tục" / "Đang nghỉ: <gate>", button offers `on`; HQ never re-arms by itself.
- SHOULD 4 (global switch from a tab): `/rules` CONDITIONS recorded above (owner-present rail unchanged); first auto-on is visible in AutoBar text.
- SHOULD 5 (error text blamed 8sync): only "unknown verb"-style errors say "chạy 8sync up"; others show the error.
- SHOULD 6 (`--room` free text): documented in meet usage (local trust). NIT 7 `.gitignore` (`su-code/standup/.meet.lock`, `*.tmp.*`). NIT 9 meeting `li` keyed by room (no replay on re-speak). NIT 10 lead clones respect `away`. NIT 8 (UTC midnight) left as is — documented limitation.
- Re-check after fixes: C1 auto 8 passed · C2 meet 8 · C3 room 6 · C4 cancel 3 + help/hint 15 · C7 clippy no output on touched files · C5 vitest 26 files / 330 passed + typecheck + lint · C6 UAT PASS (15 checks).
iter 0 | C1 | exit 0 | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 0.00s
iter 0 | C2 | exit 0 | test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 511 filtered out; finished in 0.00s
iter 0 | C3 | exit 0 | test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 513 filtered out; finished in 0.00s
iter 0 | C4 | exit 0 | test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 504 filtered out; finished in 0.05s
iter 0 | C7 | exit 0 | clippy lines in touched files: 0
