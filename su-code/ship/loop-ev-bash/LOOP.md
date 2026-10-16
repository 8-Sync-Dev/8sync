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
iter 1 | C4 | exit 0 | C4-ok: test on 3 OS success (run 38975990243)

## Brief
- All green after 2 iterations. C1/C2 local (looper tests 9 passed; with `return shell();` removed the test fails). C3 live on this box: installed 0.98.1 `exit 1 | (no output)`, branch `exit 0 | /c/Program Files/GitHub CLI/gh`. C4: CI run 38975990243 on 9e1872b, `ev_argv_bash_is_git_bash_not_the_wsl_launcher ... ok` in the windows-latest log.
- Iteration 0's red C3 was the check script (outside a su-code project loops live in `.claude/ship/`, not `su-code/ship/`); iteration 1's first C3 line is a build warning because `loop ev` prints stderr after stdout. Fixed in check.sh, no product change.
- Wall clock 338/90 min at resume: the session was down ~5 h between iterations; the owner resumed it explicitly ("tiếp tục loop loop-ev-bash").
- Out of scope, checked: 15 other bare `Command::new("sh")` spawns are safe (System32 has `bash.exe`, no `sh.exe`).
