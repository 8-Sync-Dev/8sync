---
description: "Run a full Go plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-golang — Go

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Go patterns, testing, build and review.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** as ONE Workflow (this command opts in; load `workflow-authoring` first): `phase()` per plan stage, `pipeline()` by default, each agent prompt names only its picked member files, `effort: 'low'` on mechanical stages, every code stage ends with the project's real build/type-check/lint/tests (`ecc:verification-loop`). Stopped mid-run → re-run with `resumeFromRunId`. A goal of ≤2 small steps → do it inline, no Workflow.
5. **Learn.** Last stage: one agent records only evidence-backed lessons (cause, fix, what was ruled out) via `/remember` or `trail note`; none → skip.
6. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `encore-deploy` — Deploy/secrets/rollout runbook for the 8syncdev Encore Cloud backend and Vercel frontends
- `encore-eino-go` — .dev (infrastructure-as-code services, typed SQL, cron, pubsub, auth, secrets) with CloudWeEino
- `ecc:golang-patterns` — Idiomatic Go patterns, concurrency, error handling, and project layout
- `ecc:golang-testing` — Go testing patterns, table-driven tests, benchmarks, and fuzzing

## Agents
- `ecc:go-build-resolver` — Go build, vet, and compilation error resolution
- `ecc:go-reviewer` — Go code review for idiomatic patterns and concurrency

## Commands
- `/ecc:go-build` — Fix Go build errors
- `/ecc:go-review` — Run Go code review
- `/ecc:go-test` — Run Go tests with coverage
