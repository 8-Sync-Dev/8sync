# PLAN — handoff-scripts-utf8: the release helper scripts work on Windows as written

## Goal
KNOWLEDGE:455 (Python on Windows decodes with cp1252) recurred on 2026-10-17 in the repo's own release helpers. `python3 -I su-code/handoff/scripts/merge-changelog.py <wt>` died with `TypeError: expected string or bytes-like object, got 'NoneType'`: `subprocess.run(..., text=True)` decodes `git show` with the locale codec, cp1252 cannot decode the UTF-8 of "ờ" (byte 0x9D), and the failed reader leaves `stdout` None. It only worked with `-X utf8`. Both scripts also wrote CRLF on Windows (text mode), so git warned "CRLF will be replaced by LF". `bump-version.py` needed its OLD/NEW/DATE constants edited (or exec'd with a patched copy) for every release.

Fix: `encoding="utf-8"` for `git show`, `newline=""` (LF) on every write, `bump-version.py <worktree> <old> <new> <date>` with format checks, and `test-scripts.sh` with a Vietnamese CHANGELOG conflict fixture, run on CI on all 3 OS.

## Non-goals
No change to what the scripts produce (section order, the bump's 3 files), apart from LF endings.

## Acceptance criteria
| # | Criterion | Check (exit 0 = pass) |
|---|---|---|
| C1 | `test-scripts.sh` passes on this Windows box without `-X utf8`/`PYTHONUTF8` (merge fixture with "giờ … ờ", bump fixture with CRLF input → LF output, bad args rejected, second bump refused) | `bash su-code/ship/handoff-scripts-utf8/check.sh C1` |
| C2 | The fixture catches the bug: with origin/main's `merge-changelog.py`, the test fails here | `bash su-code/ship/handoff-scripts-utf8/check.sh C2` |
| C3 | The LF check bites: with `newline=""` removed from `bump-version.py`, the test fails here | `bash su-code/ship/handoff-scripts-utf8/check.sh C3` |
| C4 | CI on the branch: `test` green on 3 OS and each job's log has the `handoff scripts ok` line | `bash su-code/ship/handoff-scripts-utf8/check.sh C4 <run-id>` |

## Tasks
- `su-code/handoff/scripts/merge-changelog.py`, `bump-version.py`; new `test-scripts.sh`.
- `.github/workflows/ci.yml`: a step in the `test` matrix job.
- CHANGELOG Unreleased; KNOWLEDGE:455 gets its guard noted.

## Risks
- On Windows runners `python3` can be the Store alias; the test takes the first of `python3`/`python` that really runs Python 3.
