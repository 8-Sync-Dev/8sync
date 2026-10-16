# PLAN — ci-size-gate: run the release size gate on every PR

## Goal
A PR that would push the linux-x86_64 musl asset over `scripts/size-gate.sh`'s ceiling fails CI before anyone tags. Seven releases (v0.67.0, v0.74.0, v0.78.0, v0.81.0, v0.89.0, v0.93.0, v0.98.0; attribution blocks in `scripts/size-gate.sh`) were tagged and then failed this gate, because nothing measured the asset earlier (KNOWLEDGE failure line, 2026-10-16, no guard yet).

## Non-goals
No local release build (CI only). No change to the ceiling or to release.yml.

## Acceptance criteria
| # | Criterion | Check (exit 0 = pass) |
|---|---|---|
| C1 | `ci.yml` has a `size-gate` job that builds `x86_64-unknown-linux-musl` release and runs `scripts/size-gate.sh` on it | `grep -q 'size-gate:' .github/workflows/ci.yml && grep -q 'cargo build --release --locked --target x86_64-unknown-linux-musl' .github/workflows/ci.yml && grep -q 'bash scripts/size-gate.sh target/x86_64-unknown-linux-musl/release/8sync' .github/workflows/ci.yml` |
| C2 | The job passes on this branch's CI run | `gh run view <run> --json jobs --jq '.jobs[]|select(.name=="size-gate")|.conclusion' \| grep -qx success` |
| C3 | It measures what the release ships: on a branch with no Rust change since v0.98.1, the size equals the published v0.98.1 linux-x86_64 asset (6,973,520 B) | `gh run view <run> --log \| grep -q 'size    6973520 bytes'` |
| C4 | The gate really fails over the ceiling (self-test step in the job) | `gh run view <run> --log \| grep -q 'self-test ok'` |

## Tasks
- Edit `.github/workflows/ci.yml` (one job, same steps as release.yml's linux-x86_64 leg).
- KNOWLEDGE: mark the size-gate failure line as guarded. CHANGELOG Unreleased (CI).
- Push branch → CI → evidence.

## Risks
- Extra ~5 min per PR (public repo: Actions free).
- Cache key differs from release.yml's, so a first run is cold.
