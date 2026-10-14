# LOOP — backlog-close
| C | check |
|---|---|
| C1 | bash scripts/uat/compact.sh |
| C2 | bash scripts/uat/up-kit.sh |
| C3 | git ls-files --error-unmatch su-code/archive/KNOWLEDGE-1791268148.md |
| C4 | grep '## Sources' outputs/hq-team-ux.md + 'Verification:' in provenance |
| C5 | bash scripts/uat/auto-levels.sh ship-auto && … autopilot |
| C6 | cargo test -p ccc-core -j2 && grep ccc-core crates/cli/Cargo.toml |
| C7 | gh pr checks (all SUCCESS) |

## Evidence
iter 0 | C3 | exit 0 | staged-copy-present
iter 0 | C6 | exit 0 | Doc-tests ccc_core
iter 0 | C5 | exit 1 | == artifacts kept in /tmp/uat-auto-4vOrNU
iter 1 | C5 | exit 1 | (no output)
iter 1 | C4 | exit 0 | brief-final
iter 1 | C5 | exit 0 | both-all-pass
iter 1 | C2 | exit 0 | RESULT: PASS
iter 1 | C1 | exit 0 | PASS: *** at 58.0 % (accepted band 50..65 % of window)
gates | sec skill | gitleaks staged: 6 hits = pre-existing #[test] fixtures moved with secret_mask/transcript (same 6 on origin/main) → WARN, no real secret; no sensitive files; cargo audit rc 0 (allowed advisories, pre-existing); kit guard+gates on
gates | aup-audit | no BLOCK/WARN: UAT uses official claude -p with the owner's login, API key env unset, toy data only; only match = the existing "never bypassPermissions" rule
iter 1 | C3 | exit 0 | su-code/archive/KNOWLEDGE-1791268148.md
