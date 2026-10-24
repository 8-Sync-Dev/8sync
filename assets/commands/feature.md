---
name: sx-feature
argument-hint: '[new <slug> | plan | go | ship | status | switch <slug> | list] [--auto]'
description: Large multi-phase feature scopes (GSD). Drives the `feature` skill — scaffold a planning tree (su-code/planning/<slug>/), plan a phase (Goal+AC), execute it via the engine_* loop, and verify against the AC matrix. Cross-session, switchable. Small/single-concern work → /sx-auto.
---

# /sx-feature — large-scope GSD framework

`$ARGUMENTS` first word selects the subcommand; `--auto` anywhere = autonomous full-phase.

Use this for **large, multi-phase features** (>10 files, multiple milestones, spanning
sessions). Small/single-concern work → **`/sx-auto`** (drive the engine directly). This layer
owns the multi-feature ROADMAP + per-phase Acceptance-Criteria contract *above* the
`engine_*` loop.

## 0. Load the skill + ground (do this first, every subcommand)
Read the bundled skill and its rules BEFORE acting:
- `~/.omp/skills/feature/SKILL.md` + `~/.omp/skills/feature/references/feature-rules.md`
  (the always-applied rules), then the reference for the specific subcommand
  (`new`/`plan`/`execute`/`ship`/`auto`).
Then ground on state (except for `new`, which creates it):
- `su-code/planning/ACTIVE.md` line 1 → active slug; `su-code/planning/<slug>/STATE.md`
  frontmatter (`status`/`active_phase`/`next_action`); `su-code/planning/config.json`
  (`workflow.*`, `paths.*`). Obey `~/.omp/agent/APPEND_SYSTEM.md` (code-intel first;
  always-on skills). Explore with **trail** (`trail ask` / `trail callers`) — never
  grep/Read-all; `headroom_compress` any tool output > ~50 lines.

## 1. Dispatch (`$ARGUMENTS` first word)
| word | do |
|------|----|
| `new <slug>` | `references/new.md` — the deterministic scaffold is also `8sync feature new <slug>`; then fill PROJECT/REQUIREMENTS/ROADMAP with the user, cut phases by dependency. Gate 1: user approves the architecture. |
| `plan` | `references/plan.md` — discuss + write `M<x>-CONTEXT.md` (📌 Requirement scope + 🎯 Goal + ✅ AC table) + `M<x>-NN-PLAN.md` (tasks ↔ UC ↔ AC, waves). Plan-review per `config.workflow.plan_review`. Gate 2: user approves the AC + plan. |
| `go` | `references/execute.md` — **delegate execution to the engine**: `engine_plan` (goal = phase Goal, slices/tasks = the PLAN, each task `verify` = the project's real lint/test/build), then loop `engine_next → engine_verify → engine_advance {commit:true}` (verify-gate + doom-loop guard are code-enforced). Tick STATE.Log + PLAN checkbox per task. |
| `ship` | `references/ship.md` — review (multi-lens via `task` reviewers) + test (`task` Tester) against the AC → write `M<x>-VERIFICATION.md` AC-matrix. Phase done ⇔ every AC PASS. Archive on the final phase. |
| `status` | print the active STATE position (same as `8sync feature status`). |
| `switch <slug>` | flip ACTIVE (same as `8sync feature switch <slug>`), then re-ground. |
| `list` | list features + archived (same as `8sync feature list`). |
| _(empty)_ | read STATE → suggest the next action from `next_action`. |

## 2. `--auto` (autonomous full-phase)
If `$ARGUMENTS` contains `--auto`, load `references/auto.md` FIRST, then run the phase
autonomously: replace user gates with a `task` discuss-agent + plan-review; run `go` via the
engine to DONE; a hard blocker (credential / real external data) → SKIP the item, record
NEEDS-CONFIRM in VERIFICATION/STATE, and finish the rest of the phase. Stop at the next phase
boundary (never auto-advance phases). This mirrors `/sx-auto`'s engine discipline, scoped to one
phase.

## Guardrails
Work must belong to the `active_phase` (stop + ask if it drifts; `--auto` → SKIP+NEEDS-CONFIRM).
Verify-gate before every commit (`engine_verify` enforces it; `engine_advance` refuses
unverified tasks). Scope edits to the change + `su-code/` memory. NO `git push` / PR unless
asked. Every AC maps to ≥1 UC in REQUIREMENTS; every task maps to ≥1 AC — no orphan work.

## Model + context budget
Use the models in `~/.config/8sync/models.toml` (view/edit: `8sync harness model`); route per
task class. When context nears the limit (auto-compacts at 50%), write a handoff into the
active feature's `su-code/planning/<slug>/STATE.md` (< 100 lines, digest) BEFORE it fires.

Begin: load the skill, ground on ACTIVE + STATE + config, then act on `$ARGUMENTS`.
