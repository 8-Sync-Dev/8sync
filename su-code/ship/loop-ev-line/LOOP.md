# LOOP — loop-ev-line

| Criterion | Check |
|---|---|
| C1 | `check.sh C1`: looper unit tests pass (niced, -j2) |
| C2 | `check.sh C2`: with the old stream choice, the looper test fails; source restored |
| C3 | `check.sh C3`: debug binary records `verdict-ok`, installed binary records `noise` |
| C4 | `check.sh C4 <run>`: CI `test` success on 3 OS |

## Evidence
iter 0 | C1 | exit 0 | C1-ok
iter 0 | C2 | exit 0 | C2-ok: with the old stream choice the looper test fails (source restored)
iter 0 | C3 | exit 0 | C3-ok: the verdict line is recorded, not stderr
