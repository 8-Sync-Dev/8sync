# hq-live-apply — LOOP (max-iter 8 · max-min 60)

| # | Criterion | Lệnh |
|---|---|---|
| C1 | live marker + resolve_peer | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code hq::` |
| C2 | kit reload hint | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code kit_` |
| C3 | HQ vitest | `pnpm vitest run tests/team-thread.test.ts tests/assign-ui.test.ts tests/office.test.ts` |
| C4 | HQ typecheck | `pnpm tsc --noEmit` |
| C5 | clippy | `cargo clippy -q -j2 -p su-code -- -D warnings` |
| C6 | CI 3 OS | `gh run watch <id> --exit-status` |

## Evidence
iter 0 | C1 | exit 101 | error: could not compile `su-code` (bin "8sync" test) due to 1 previous error
iter 0 | C1 | exit 0 | test result: ok. 55 passed; 0 failed; 0 ignored; 0 measured; 440 filtered out; finished in 1.50s
iter 0 | C3 | exit 0 | Duration  421ms (transform 55%, tests 25%, import 12%, setup 4%, worker 3%)
iter 0 | C4 | exit 2 | tests/assign-ui.test.ts(104,102): error TS2353: Object literal may only specify known properties, and 'inbox_live' does not exist in type 'S'.
iter 0 | C4 | exit 0 | (no output)
iter 0 | C2 | exit 0 | test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 475 filtered out; finished in 0.02s
iter 0 | C5 | exit 101 | error: could not compile `su-code` (bin "8sync") due to 40 previous errors
iter 0 | C5 | exit 0 | no clippy errors in touched files (38 pre-existing elsewhere, same as origin/main)
iter 0 | C1 | exit 0 | test result: ok. 55 passed; 0 failed; 0 ignored; 0 measured; 440 filtered out; finished in 1.50s
iter 0 | C2 | exit 0 | test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 475 filtered out; finished in 0.02s

## D — review gates (iter 0, 2026-10-16)
- `/sec`: gitleaks `--no-git` on the 20 diff files → 1 hit = pre-existing masker test fixture `hq.rs` (commit 48c42886, line not in this diff). Regex on diff: none. Sensitive tracked files: none. `cargo audit`: 3 advisories, same as origin/main (proc-macro-error2 unmaintained + 2 parked). `pnpm audit --prod`: braces ≤3.0.3 high, pre-existing on origin/main (parked, not ours). Kit 38/38 · guard · gates on. New code: no unsafe/eval/exec; path inputs pass `safe_id`/`isSessionId` before touching the inbox dir. → OK.
iter 0 | C1 | exit 0 | test result: ok. 55 passed; 0 failed; 0 ignored; 0 measured; 440 filtered out; finished in 1.50s
iter 0 | C2 | exit 0 | test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 475 filtered out; finished in 0.02s
iter 0 | C3 | exit 0 | Duration  341ms (transform 45%, tests 31%, import 15%, setup 5%, worker 3%)
iter 0 | C4 | exit 0 | (no output)
iter 0 | C5 | exit 0 | no clippy errors in touched files (pre-existing elsewhere, same as origin/main)
- Reviewer (iter 0): MERGEABLE, 0 BLOCKER, 6 SHOULD, 4 NIT — all applied: marker = "loaded in the last day" (a long turn does not poll, no false "chưa nạp mod"), marker 0600 / dir 0700, `ccc . ls` line only for inbox-addressable sessions, reload hint only for rewritten mod files (not first install) and `8sync up` forwards the kit's real hint line instead of nagging, `sameParty` prefers uuid equality (two sessions named "core" test), `strip_ref` tries the exact name first and ignores empty refs, dedup removed, CHANGELOG blank line. `/sec` re-check on the fixed files: gitleaks no leaks; the only `Command::new` is the pre-existing `ccc kit` subprocess in up.rs (`.status()` → `.output()`).
- UAT: debug binary `8sync ccc . ls` in 8sync-startup printed the `inbox: chưa nạp mod — … /reload-plugins` line for the 5 open sessions (matches the zero-poll observation).
