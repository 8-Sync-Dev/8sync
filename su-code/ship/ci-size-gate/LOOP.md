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
