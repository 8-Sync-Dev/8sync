# PLAN — loop-ev-line: `loop ev` records the verdict line, not stderr noise

## Goal
KNOWLEDGE:456 (no guard yet): `8sync ccc loop ev` builds its evidence line from the last line of stdout followed by stderr. A passing check's verdict is on stdout (libtest's `test result: ok. N passed`, a script's `C3-ok`), while cargo's `Running unittests …` and build warnings arrive on stderr, so a green row reads like noise. It happened again on 2026-10-16: `su-code/ship/loop-ev-bash/LOOP.md` iter 1 C3 recorded `= note: #[warn(unreachable_code)] …` instead of `C3-ok`. Fix: exit 0 → last non-empty stdout line; any other exit → last non-empty stderr line (where errors go); either stream falls back to the other when it has no line.

## Non-goals
The 15-line tail that `ev` prints stays as it is (stdout, then stderr). No change to how the command is run.

## Acceptance criteria
| # | Criterion | Check (exit 0 = pass) |
|---|---|---|
| C1 | Unit tests: pass + stderr noise → stdout verdict; failure → stderr error; one empty stream → the other; existing looper tests still pass | `bash su-code/ship/loop-ev-line/check.sh C1` (`cargo test -p su-code --bin 8sync looper -j2`, niced) |
| C2 | The test catches the bug: with the stream choice reverted to "stdout then stderr", the new test fails | `bash su-code/ship/loop-ev-line/check.sh C2` |
| C3 | Live: the branch's debug binary records `verdict-ok` for `-- sh -c 'echo verdict-ok; echo noise >&2'`, where the installed binary records `noise` | `bash su-code/ship/loop-ev-line/check.sh C3` |
| C4 | CI on the branch: `test` green on 3 OS | `bash su-code/ship/loop-ev-line/check.sh C4 <run-id>` |

## Tasks
- `crates/cli/src/verbs/ccc/looper.rs`: mask stdout and stderr separately, `evidence_line(ok, stdout, stderr)`, keep a newline between the streams in the printed tail; test.
- CHANGELOG Unreleased `### Fixed`; KNOWLEDGE:456 gets its guard noted.

## Risks
- A failing check that prints its reason on stdout and an unrelated line on stderr now shows the stderr line. Scripts in `su-code/ship/*/check.sh` print `C#-fail` on stdout with nothing on stderr, so they keep their line (fallback).
