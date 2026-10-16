# omc-cancel-risk — LOOP (max-iter 10 · max-min 90)

| # | Criterion | Lệnh |
|---|---|---|
| C1 | cancel tests | `cargo test -q -j2 -p su-code cancel_` |
| C2 | risk tests | `cargo test -q -j2 -p su-code risk_` |
| C3 | help/hint tables | `cargo test -q -j2 -p su-code 'ccc::help'` + `hint_` |
| C4 | research doc | `test -s research/omc-features.md …` |
| C5 | UAT script | `scripts/uat/omc-cancel-risk.sh` |
| C6 | clippy touched | see PLAN |
| C7 | CI 3 OS | `gh run watch <id> --exit-status` |

## Evidence
iter 0 | C1 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 498 filtered out; finished in 0.00s
iter 0 | C2 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 498 filtered out; finished in 0.03s
iter 0 | C4 | exit 0 | (no output)
iter 0 | C3 | exit 0 | test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 486 filtered out; finished in 0.05s
iter 0 | C6 | exit 1 | --> crates/cli/src/verbs/ccc/looper.rs:218:16
iter 0 | C6 | exit 0 | (no output)
iter 0 | C5 | exit 0 | PASS: *** names gates on the real diff; cancel is fail-closed and stops the loop
iter 0 | C2 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 498 filtered out; finished in 0.03s

## Review gates (iter 0, 2026-10-16)
- `/sec`: gitleaks 8.x `--no-git` on the 16 touched files → "no leaks found"; regex: one hit = pre-existing test fixture ccc.rs (fake masked key, not in diff). Sensitive tracked files: none. `cargo audit`: fxhash/proc-macro-error2 unmaintained + anyhow unsound — same 3 as main (parked). Kit 38/38 · guard · gates on; managed settings none (known). New code: no unsafe/eval/shell; `risk` calls git with argv (no shell) and now rejects a `--base` starting with `-` (test added). `cancel` writes only under su-code/ship/<valid slug>/loop.json, ACTIVE, registry, features.toml. → OK.
- `8sync ccc risk` on this diff: level low, gate `/sec` only (no auth/data/messaging/third-party/secret/release/high-risk paths). Release gates (`/rules` + `/aup-audit`) run before the v0.93.3 tag as the kit rule says.
iter 0 | C2 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 498 filtered out; finished in 0.03s
iter 0 | C2 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 498 filtered out; finished in 0.04s
iter 0 | C1 | exit 0 | test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 498 filtered out; finished in 0.00s
iter 0 | C3 | exit 0 | test result: ok. 15 passed; 0 failed; 0 ignored; 0 measured; 486 filtered out; finished in 0.05s
iter 0 | C6 | exit 0 | (no output)
iter 0 | C5 | exit 0 | PASS: *** names gates on the real diff; cancel is fail-closed and stops the loop
iter 0 | C4 | exit 0 | (no output)
- Reviewer (iter 0): NOT MERGEABLE → 1 BLOCKER (fail-closed holes: ACTIVE deleted after a failed step, read errors as empty, invalid slugs dropped, `--all` skipping corrupt loops, env override unchecked, no read-back) + 5 SHOULD (loop scope wording, substring false positives, git from subdir/-z/base fallback, `--release`, staging) + 4 NIT — all applied; tests C1 3 pass, C2 3 pass, C3 15 pass, C5 PASS, C6 clean (re-run after fixes).
- Owner (2026-10-16, mid-turn): "nhớ luôn check tuân thủ /rules /aup-audit /sec" → all three run on this diff: `/rules` ALLOWED (rules file 2026-10-11, AUP snapshot 2026-10-12: local-only CLI, no token/proxy, ideas from MIT repo); `/aup-audit` no BLOCK/WARN (gitleaks history + touched files clean, no sensitive files, keyword hits = rule tables/prose/research notes); `/sec` OK again on the post-review diff. `8sync ccc risk --release` on this diff: rules + aup-audit required (third-party manifests + plugin.json version bump).
