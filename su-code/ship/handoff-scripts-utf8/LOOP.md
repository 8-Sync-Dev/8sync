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
