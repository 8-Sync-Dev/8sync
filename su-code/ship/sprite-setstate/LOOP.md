# LOOP — sprite-setstate

| Criterion | Check |
|---|---|
| C1 | `check.sh C1`: test file mounts `mountSprite` and calls `setState` |
| C2 | `check.sh C2`: vitest run of the file passes locally |
| C3 | `check.sh C3`: 3 mutations of render.ts each make it fail; source restored |
| C4 | `check.sh C4 <run>`: CI `hq-ui-test` success + `test` 3 OS success |

## Evidence
iter 0 | C1 | exit 0 | C1-ok: 7 cases in apps/hq-ui/tests/sprite-setstate.test.ts
iter 0 | C2 | exit 0 | C2-ok
iter 0 | C3 | exit 0 | C3-ok: 3/3 mutations killed, apps/hq-ui/lib/sprite/render.ts restored
