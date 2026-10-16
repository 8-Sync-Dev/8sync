# PLAN — loop-ev-bash: `loop ev -- bash …` runs Git Bash on Windows, not WSL

## Goal
Found in autopilot item ci-size-gate (2026-10-16): `8sync ccc loop ev ci-size-gate C2 -- bash su-code/ship/ci-size-gate/cjob.sh …` printed `gh: command not found`, exit 127, while `gh` and Git Bash are first on PATH. The argv form spawns `Command::new("bash")`, and Windows resolves a bare name in the system directories before PATH, so it ran `C:\Windows\System32\bash.exe` (the WSL launcher). The one-string form already picks Git Bash (`shell()`), and its error message even tells users to switch to the argv form. Route a bare `bash`/`sh` (with or without `.exe`) in the argv form through `shell()` on Windows; every other program is unchanged.

## Non-goals
No change on Linux/macOS (bare names already resolve through PATH there). No change to the one-string form.

## Acceptance criteria
| # | Criterion | Check (exit 0 = pass) |
|---|---|---|
| C1 | Unit tests for the argv program and an argv `bash -c` evidence line pass | `bash su-code/ship/loop-ev-bash/check.sh C1` (`cargo test -p su-code --bin 8sync looper -j2`, niced) |
| C2 | The test catches the bug: with the routing removed, the unit test fails on this Windows box | `bash su-code/ship/loop-ev-bash/check.sh C2` |
| C3 | Live repro fixed: the new binary's `loop ev <tmp slug> X -- bash -c "command -v gh"` exits 0 here (was 127 with the installed binary) | `bash su-code/ship/loop-ev-bash/check.sh C3` |
| C4 | CI on the branch: `test` green on 3 OS (the Windows runner has the WSL launcher in System32 and no distro) | `bash su-code/ship/loop-ev-bash/check.sh C4 <run-id>` |

## Tasks
- `crates/cli/src/verbs/ccc/looper.rs`: `program()` helper used by the argv branch; fix the `shell()` hint; tests.
- CHANGELOG Unreleased `### Fixed`; KNOWLEDGE lesson (Windows resolves bare names in System32 before PATH).

## Risks
- A user who really wants WSL bash must now spell the full path (`C:\Windows\System32\bash.exe`); noted in the error text and CHANGELOG.
