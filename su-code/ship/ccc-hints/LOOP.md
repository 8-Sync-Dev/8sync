# ccc-hints — LOOP (max-iter 12 · max-min 90)

| # | Criterion | Lệnh |
|---|---|---|
| C1 | hint rules + latency | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code hint_` |
| C2 | mod validate | `claude plugin validate assets/claude/skills/8sync-hints` |
| C3 | mod tests | `claude plugin test assets/claude/skills/8sync-hints` |
| C4 | completions | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code completions_` |
| C5 | kit installs mod | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code kit_` |
| C6 | mod loads in claude -p | `bash scripts/uat/hints-load.sh` |
| C7 | omp feature scan doc | `test -s research/omp-features.md && [ "$(grep -c '^| ' research/omp-features.md)" -ge 30 ] && grep -q MIT research/omp-features.md` |
| C8 | clippy touched files | see PLAN |
| C9 | CI 3 OS | `gh run watch <id> --exit-status` |

## Evidence
iter 0 | C1 | exit 101 | error: test failed, to rerun pass `-p su-code --bin 8sync`
iter 0 | C1 | exit 0 | test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 475 filtered out; finished in 0.01s
iter 0 | C4 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 483 filtered out; finished in 0.01s
iter 0 | C7 | exit 0 | (no output)
iter 1 | C2 | exit 0 | ✔ Validation passed
iter 1 | C3 | exit 0 | Ran 7 tests across 1 file. [0.26s]
iter 1 | C1 | exit 0 | test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 476 filtered out; finished in 0.00s
iter 1 | C5 | exit 0 | test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 469 filtered out; finished in 0.02s
iter 1 | C4 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 484 filtered out; finished in 0.01s
iter 1 | C8 | exit 0 | (no output)
iter 1 | C6 | exit 0 | PASS: *** loads in claude -p and 8sync ccc hint answers

## D — review gates (iter 1, 2026-10-16)
- `/sec`: gitleaks 8.x `--no-git` on the 23 diff/untracked files → "no leaks found"; the 15 hits of a full-tree scan are pre-existing test fixtures (secret_mask.rs, transcript.rs, hq.rs) and the ignored `apps/hq-ui/.next` dev cache. Regex on diff: none. Sensitive files: only `assets/configs/kitty.session` (pre-existing, not read). `cargo audit`: RUSTSEC-2026-0190 (anyhow, parked). Kit status: 29/29 · guard · gates on. New code: no unsafe/eval/http/shell. → OK.
- `/rules` (rules file "Cập nhật: 2026-10-11"): ALLOWED — the mod is a Claude Code plugin through the documented function-hooks API (code.claude.com/docs/en/plugins), runs inside the owner's own official client (subscription token never leaves Claude Code, no proxy/fake client — AUP "Do Not Abuse Our Platform" not touched); `hint` reads only the owner's own local files (history.jsonl, skills, ship, registry) and sends nothing anywhere.
- `/aup-audit` on the diff: no AUP signal (RULES.md table) — no PII, scraping, mass contact, impersonation; the one new data read (local prompt history) stays on the machine and is disclosed in CHANGELOG. → no BLOCK/WARN.
iter 1 | C1 | exit 0 | test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 476 filtered out; finished in 0.05s
iter 1 | C4 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 487 filtered out; finished in 0.01s
iter 1 | C5 | exit 0 | test result: ok. 18 passed; 0 failed; 0 ignored; 0 measured; 472 filtered out; finished in 0.02s
iter 1 | C2 | exit 0 | ✔ Validation passed
iter 1 | C3 | exit 0 | Ran 8 tests across 1 file. [0.30s]
iter 1 | C7 | exit 0 | (no output)
iter 1 | C6 | exit 0 | PASS: *** loads in claude -p and 8sync ccc hint answers
iter 1 | C1 | exit 0 | test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 476 filtered out; finished in 0.05s
iter 1 | C8 | exit 0 | (no output)
iter 1 | C9 | exit 1 | package-hq-ui: .github#1
iter 2 | C9 | exit 0 | test (ubuntu-latest): .github#1

## Kết thúc (iter 2, 2026-10-16)
Tất cả C1–C9 xanh. C9: CI run 38837734481 đỏ trên Windows (git status > 50 ms) → fix 7762610 (GIT_BUDGET 300 ms) → run 38838076659 xanh 3 OS. Reviewer (NOT MERGEABLE → 1 BLOCKER + 8 SHOULD + NIT) và QA UAT (2 FAIL: UTF-8 history, untracked dirty) đã sửa hết. Not verified: dòng `/` trùng menu engine ở đầu ô (đã bỏ start=0); ghost text trong phiên thật cần restart.
