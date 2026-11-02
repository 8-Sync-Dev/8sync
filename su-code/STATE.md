# v0.116.0 — HQ omp workspace + redesign + eco heavy renderers; ECC auto-update for omp

## Goal
Owner 2026-11-02: HQ on OVH (vps.8syncdev.com/hq) = Rust-native, fast, realtime, HTTP/3, strong security, modern (look of content-ai "Sử dụng" dashboard). omp first: folder tree → `8sync . ls` → open/create session → multi-pane. ECC full skills auto-update for omp + Claude Code, `/eccx-full` uses ECC + 8sync harness. PC: lowest power, stable all-day long tasks. Later: per-project public artifact link (comments, email allowlist roles view/comment/edit, tracking, comments reach omp).

## Checklist
- [x] PR #259: Workspace tab, `ccc term --omp-new`, `/api/tree|omp/sessions|commands`, slash autocomplete, eco `heavy` + `eco restart` + HQ button, lime/zinc redesign, lazy tabs. Reviewer: OK (2 P3 fixed). cargo 620 ok · vitest 698 ok · tsc · lint 0 err · next build · browser 1440/430.
- [x] Bump 0.116.0 (Cargo.toml, Cargo.lock, plugin.json, CHANGELOG).
- [ ] Merge #259 → tag v0.116.0 → release → `8sync up` → HQ local 200.
- [ ] ECC auto-update for omp (agent EccAuto, branch feat/ecc-auto-update).
- [ ] VPS UAT: blocked — vps.8syncdev.com unreachable (HTTPS/SSH/ping timeout since 2026-11-01 ~17:00); owner must check OVH Manager.
- [ ] Branch cleanup (bundle backup `~/.local/state/8sync/backup/su-code-branches-2026-11-02.bundle`).
- [ ] Artifact public-link feature (not started).
- [ ] content-post-agency `feat/omp-key-activity` (worktree C:/tmp/cpa-omp-keys): activity route done, UI not built.

## Current
Shipping v0.116.0. PC tuned: display off 10 min, AC sleep never, MuMuPlayer closed, Defender exclusions UAC sent.

## Next
Merge + release, install, then branch cleanup, then ECC PR.
