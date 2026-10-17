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
iter 0 | C4 | exit 0 | C4-ok: test on 3 OS success (run 38985307367)

## Brief
- All green in iteration 0. C1: looper tests 10 passed. C2: with the stream choice reverted to `(stderr, stdout)` the new test fails. C3 live on this box: installed 0.98.1 records `noise`, the branch records `verdict-ok`. C4: CI run 38985307367 on e9a5f36, `ev_evidence_is_the_verdict_stream_not_stderr_noise ... ok` in the ubuntu, macos and windows logs.
- Guard for KNOWLEDGE:456, which recurred as loop-ev-bash's iter 1 C3 row (a build warning instead of `C3-ok`).
