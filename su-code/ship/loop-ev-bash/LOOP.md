# LOOP — loop-ev-bash

| Criterion | Check |
|---|---|
| C1 | `check.sh C1`: looper unit tests pass (niced, -j2) |
| C2 | `check.sh C2`: with the routing removed, the unit test fails; source restored |
| C3 | `check.sh C3`: debug binary `loop ev … -- bash -c "command -v gh"` exits 0 |
| C4 | `check.sh C4 <run>`: CI `test` success on 3 OS |

## Evidence
iter 0 | C1 | exit 0 | C1-ok
iter 0 | C2 | exit 0 | C2-ok: without the routing the looper test fails (source restored)
iter 0 | C3 | exit 1 | cat: /tmp/tmp.yur4wPDPNv/su-code/ship/new/LOOP.md: No such file or directory
iter 1 | C3 | exit 0 | = note: `#[warn(unreachable_code)]` (part of `#[warn(unused)]`) on by default
iter 1 | C3 | exit 0 | C3-ok: argv bash found gh
