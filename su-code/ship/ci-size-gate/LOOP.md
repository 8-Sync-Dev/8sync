# LOOP — ci-size-gate

| Criterion | Check |
|---|---|
| C1 | grep `size-gate:` + musl release build + size-gate.sh in `.github/workflows/ci.yml` |
| C2 | CI run on `ci/size-gate-on-prs`: job `size-gate` = success |
| C3 | job log has `size    6973520 bytes` (= v0.98.1 linux-x86_64 asset) |
| C4 | job log has `self-test ok` |

## Evidence
iter 0 | C1 | exit 0 | C1-ok
iter 0 | C1 | exit 0 | C1-ok
iter 0 | C2 | exit 127 | su-code/ship/ci-size-gate/cjob.sh: line 5: gh: command not found
iter 0 | C3 | exit 127 | su-code/ship/ci-size-gate/cjob.sh: line 5: gh: command not found
iter 0 | C4 | exit 127 | su-code/ship/ci-size-gate/cjob.sh: line 5: gh: command not found
iter 0 | C2 | exit 0 | C2-ok: run 38932920686 job 117081139898 success
iter 0 | C3 | exit 0 | C3-ok: size    6973520 bytes = v0.98.1 linux-x86_64 asset
iter 0 | C4 | exit 0 | C4-ok: self-test ok in job 117081139898

## Brief
- All green in iteration 0: C1 local; C2-C4 on CI run 38932920686 (workflow_dispatch on 6eb691f; test on 3 OS, minimal, hq-ui-test, package-hq-ui also success).
- C3 measured 6,973,520 B, byte-equal to the published v0.98.1 linux-x86_64 asset: the job measures what the release ships.
- The three `exit 127` lines are the harness, not the job: `loop ev -- bash x.sh …` (argv form) spawned `C:\Windows\System32\bash.exe` (WSL, no `gh`). Re-run with Git Bash by absolute path. Follow-up item: route argv `bash`/`sh` through `shell()` on Windows.
