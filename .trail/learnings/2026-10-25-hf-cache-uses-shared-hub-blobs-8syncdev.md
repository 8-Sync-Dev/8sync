---
title: HF cache uses shared hub/blobs; model age by atime is untrustworthy; hf cache prune deletes pinned repos
author: 8syncdev
date: 2026-10-25
branch: feat/awake-until-off-clean-dev
cost: { minutes: 24, tokens: 381718 }
id: l-81cb4912
scope: repo
status: active
src: agent
touches:
  - AGENTS.md
  - CHANGELOG.md
  - apps/hq-ui/components/hq/machine-chip.tsx
  - apps/hq-ui/components/hq/machine-view.tsx
  - apps/hq-ui/lib/server/awake.ts
  - apps/hq-ui/tests/awake-switch.test.ts
  - assets/claude/skills/clean/SKILL.md
  - assets/configs/claude/CLAUDE.md
  - crates/cli/src/platform.rs
  - crates/cli/src/verbs/ccc.rs
---

## Decided
- crates/cli/src/verbs/clean_dev.rs lists Hugging Face models through `hf cache ls --json`, not by walking `hub/models--*`. huggingface_hub 1.x keeps blobs shared in `hub/blobs/<2 chars>/…` (marker `.huggingface-shared-blobs`), so a repo folder can be 0 KB while it holds 20+ GB (35 GB sat in hub/blobs on the owner's machine 2026-10-25). Models are removed with `hf cache rm model/<repo> -y`.
- Models are never removed by age. Only listed, and the owner picks.

## Tried and ruled out
- "Unused for N days" from access time (`--models-older`): one `hf cache ls` run set every model to "28 seconds ago". Scans bump atime, so it can't be trusted.
- Running `hf cache prune` automatically: it removes whole repos with no refs (e.g. bge-reranker-v2-m3, 2.3 GB). Those are usually models code pins by commit, so they are still in use. Only `*.incomplete` files older than a day are auto-deleted.

## Watch out
- schtasks `/SC MINUTE /MO` accepts only 1–1439, so `--timer 24h` must use `/SC DAILY` (crates/cli/src/platform.rs `schtasks_schedule`).
- The walk test failure was a nested repo directly under the root: skip any child dir that has its own `.git` at any depth, depth 0 included.
