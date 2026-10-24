---
name: sx-plan
argument-hint: '[<goal>] [--review|--no-review] [--no-engine]'
description: Research-first, own-the-decomposition PLANNING — produce a durable, independently-reviewed plan (engine_plan + su-code/STATE.md) and STOP, without writing code. The separated planning half of /sx-auto; hands off to /sx-auto (run) or /sx-feature (multi-phase). Use when the goal is unfamiliar, multi-slice, or high-risk and you want the plan signed off before a line of code.
---

# /sx-plan — plan it properly, then stop

`$ARGUMENTS` = the goal. `--no-review` skips the independent plan-review gate (default ON). `--no-engine` writes the plan to `su-code/STATE.md` only, without calling `engine_plan` (use when you want a human-readable plan, not the durable task ledger).

This command **extends omp canonically** — every step composes an omp-native primitive, so an omp upgrade flows through automatically. It reinvents nothing.

| step | omp primitive it extends | why that one |
|------|--------------------------|--------------|
| Ground | `recall`/`reflect` + `su-code/STATE.md` + `KNOWLEDGE.md` | past decisions live in Mnemopi + project memory; not re-deriving |
| Research | trail (`trail ask` / `trail callers`) · `web_search` · feynman skills (`deep-research`/`research-paper`) · `last30days` | cheapest-first code intel + grounded external facts |
| Decompose | your own judgement (NEVER a planning subagent) + `engine_plan` | the top-level decomposition is taste; the ledger is omp's |
| Review | `task` → `reviewer` (fresh context) | an author cannot see the hole in their own plan |
| Handoff | `engine_status` + `su-code/STATE.md` | durable state survives compaction + cold resume |

## 0. Ground (token-lean, always)
1. `reflect` on the goal (past decisions/preferences) + `recall` any matching `failure:` / `validated:` entries in `su-code/KNOWLEDGE.md`. Traps already paid for; re-paying is the most expensive mistake.
2. Read `su-code/STATE.md` (current spine) + `su-code/PROJECT.md` (stack, entrypoints, the REAL build/test/lint commands — these become the verify gate).
3. Map the code with **trail** (`trail map` / `trail ask`) — never grep/Read-all. `mcp__headroom_compress` any tool output > ~50 lines.

## 1. Right-size (ponytail gate — refuse honestly)
Is this even a planning job?
- **Trivial** (a few files, clear path) → STOP. Say "this is `/sx-auto` with no ceremony" and do not plan. Planning a 1-line fix is ceremony tax.
- **Single concern, medium** → plan inline, hand to `/sx-auto`.
- **Multi-slice / unfamiliar / high-risk** → you are in the right place. Continue.
- **Large, multi-phase, multi-session (>10 files, milestones)** → STOP and point at `/sx-feature` (the GSD layer owns AC matrices + roadmaps); this command does not.

State the verdict in one line before continuing.

## 2. Research — resolve unknowns BEFORE the plan, not during it
The part every planner skips. A plan built on guesses is a guess wearing a Gantt chart.
- **Codebase unknowns** → `trail ask` / `trail callers <symbol>`.
- **Domain / library / API unknowns** → `librarian` subagent to read the dependency's real source + feynman skills (`deep-research`/`research-paper`) + `web_search`; `last30days` when recency matters (a 2023 answer about a 2026 API is a liability).
- Write every conclusion into `su-code/STATE.md` under `## Assumptions`, each with its **source** (a path, a URL, a symbol). An assumption with no source is a guess wearing a costume.

**Gate:** every unknown is either answered or explicitly listed as an accepted risk. Then continue.

## 3. Decompose — own this yourself (never delegate the top level)
A planning subagent starts blank and knows less than you do. You own:
- **Slices** — coherent units of work with real acceptance criteria, smallest-first.
- **Cross-slice contracts NOW** — interfaces, schemas, file ownership. Contracts settled late become merge conflicts. Write them into `su-code/STATE.md` under `## Contracts`.
- **Verify command per task** = the project's REAL lint/test/build (probed from `PROJECT.md`, not invented). This is the gate `/sx-auto` will later enforce.
- **Non-goals** — state out loud what is deliberately out of scope.

Each task must be independently verifiable. If a task has no verify command, it is not a task — it is a wish.

## 4. Write the plan durably (omp-native state)
Unless `--no-engine`:
```
engine_plan { goal, slices:[ { name, tasks:[ {name, verify:[...]} ] } ] }
```
Then rewrite `su-code/STATE.md` spine (Goal · Checklist · Current · Next · Assumptions · Contracts · Non-goals) as a delta over what you read in step 0. `engine_status` must agree with STATE — if they diverge, STATE is wrong.

## 5. Plan-review gate (default ON; `--no-review` skips only for throwaway plans)
A plan is not done because the author stopped typing. Launch a fresh `reviewer` subagent (independent context, never your own re-read) with: the goal, the slice/task breakdown, the contracts, the Assumptions+sources, and the verify commands. Ask it to break the plan:
- **Missing slices** — work the decomposition forgot (error paths, migrations, docs, config, tests, cleanup).
- **Phantom tasks** — tasks with no verify command, or a verify that does not actually cover the task's claim.
- **Contract gaps** — two slices that touch the same file / assume incompatible shapes.
- **Wrong verify** — a verify command that is not the project's real gate (invented `npm test` where the project uses `pnpm`, etc.).
- **Hidden assumptions** — an "assumption" with no source, or a source that does not say what the plan claims.

Fix findings at the root, then **re-review the fix**. One clean round is luck; require the plan to survive a second pass. Treat a clean review as suspicious — reviewers routinely find the release-breaking hole the author cannot see.

## 6. Handoff — STOP (this command does not execute)
Planning and execution are separable; mixing them is how scope creeps. Do not edit code. Print:
- `engine_status` (durable ledger) and the `su-code/STATE.md` spine (human handoff).
- The single next action: **`/sx-auto <goal>`** to run the plan (or **`/sx-feature new <slug>`** if it grew into multi-phase). Say which.
- Any accepted risk carried forward, with its source.

## Guardrails
Planning only — NO code edits, NO `git push`/PR/tag. Verify commands must be the project's REAL gate (probe, don't guess). An assumption with no source is a guess. Never delegate the top-level decomposition. If research reveals the goal is actually trivial or actually multi-phase, re-route (step 1) instead of forcing a plan. `--no-engine` is for human-readable-only plans; the durable ledger is the default because it survives compaction and cold resume.

## Model + context budget
Route per task class via `~/.config/8sync/models.toml` (`8sync harness model`): a cheaper model for the mechanical decompose, a stronger one for the plan-review pass. Never above the configured ceiling. When context nears the 50% compaction line, the plan is already in `su-code/STATE.md` + `engine_plan` — the handoff survives the compact by construction.

Begin: ground, right-size, research, decompose, write durably, review, then hand off — do not execute.
