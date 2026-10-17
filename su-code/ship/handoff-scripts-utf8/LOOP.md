# LOOP — handoff-scripts-utf8

| Criterion | Check |
|---|---|
| C1 | `check.sh C1`: test-scripts.sh passes here (Windows, no `-X utf8`) |
| C2 | `check.sh C2`: origin/main's merge-changelog.py fails the UTF-8 fixture |
| C3 | `check.sh C3`: without `newline=""`, the LF check fails |
| C4 | `check.sh C4 <run>`: CI `test` success on 3 OS + `handoff scripts ok` in 3 logs |

## Evidence
iter 0 | C1 | exit 0 | C1-ok
iter 0 | C2 | exit 0 | C2-ok: origin/main's merge-changelog.py fails the UTF-8 fixture
iter 0 | C3 | exit 1 | C3-fail: CRLF output passed
iter 1 | C1 | exit 0 | C1-ok
iter 1 | C2 | exit 0 | C2-ok: origin/main's merge-changelog.py fails the UTF-8 fixture
iter 1 | C3 | exit 0 | C3-ok: without newline="" the LF check fails
iter 1 | C4 | exit 0 | C4-ok: test on 3 OS success, helper scripts ok in 3 logs (run 38985754006)

## Brief
- All green in iteration 1. C1: test-scripts.sh passes on this Windows box without `-X utf8`. C2: origin/main's merge-changelog.py fails the Vietnamese fixture. C3: with `newline=""` removed, bump-version.py fails "CR in". C4: CI run 38985754006 on 81a0f03, test success on 3 OS; logs print `handoff scripts ok (Linux, 3.12.3)`, `(Darwin, 3.15.0)`, `(MINGW64_NT-10.0-26100, 3.12.10)`.
- Iteration 0 C3 was red because the check itself was blind: Git for Windows' grep drops the CR, so `grep $'\r'` never matched. test-scripts.sh now checks bytes with Python.
- Guard for KNOWLEDGE:455 (cp1252 on Windows), which recurred in the v0.98.2 Ship as merge-changelog.py's `TypeError … NoneType`.
