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
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- Skills: Skill tool — `ecc:<name>` = ECC plugin, plain name = 8sync skill (`~/.claude/skills/`).
- Agents: Task subagent with `subagent_type: "ecc:<agent>"`.
- Commands: run `/ecc:<cmd>` with that step's arguments.
- Needs the ECC plugin (`ecc@ecc`, enabled by `8sync ccc kit`). A member that does not resolve: skip it, say so.

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
