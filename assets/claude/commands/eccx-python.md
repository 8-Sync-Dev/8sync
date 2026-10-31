---
description: "Run a full Python plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-python — Python

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Python, Django, FastAPI, PyTorch, ML engineering.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:django-celery` — Django + Celery async task patterns
- `ecc:django-patterns` — Django architecture, DRF, ORM best practices, and caching
- `ecc:django-tdd` — Django testing with pytest-django, factory_boy, and coverage
- `ecc:django-verification` — Django verification loop: migrations, linting, tests, and security scans
- `ecc:fastapi-patterns` — FastAPI best practices covering project structure, Pydantic v2 schemas, dependency injection, async
- `ecc:generating-python-installer` — Commercial-grade Python installer expert for Windows: Nuitka extreme compilation, dist slimming, DLL
- `ecc:ml-adoption-playbook` — End-to-end methodology for AI agents and software engineers to add machine learning
- `ecc:mle-workflow` — Production machine-learning engineering workflow for data contracts, reproducible training, model evaluation, deployment
- `ecc:python-patterns` — Pythonic idioms, type hints, async patterns, and project structure
- `ecc:python-testing` — Pytest patterns, fixtures, mocking, and coverage configuration
- `ecc:pytorch-patterns` — PyTorch deep learning patterns and best practices for building
- `ecc:recsys-pipeline-architect` — Design composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework

## Agents
- `ecc:django-build-resolver` — Django/Python build, migration, and dependency error resolution specialist
- `ecc:django-reviewer` — Expert Django code reviewer specializing in ORM correctness, DRF patterns, migration safety
- `ecc:fastapi-reviewer` — Reviews FastAPI applications for async correctness, dependency injection, Pydantic schemas, security, OpenAPI
- `ecc:mle-reviewer` — Production machine-learning engineering reviewer for data contracts, feature pipelines, training reproducibility, offline/online
- `ecc:python-reviewer` — Python code review for PEP 8, type hints, and security
- `ecc:pytorch-build-resolver` — PyTorch runtime, CUDA, and training error resolution specialist

## Commands
- `/ecc:fastapi-review` — Review a FastAPI application for architecture, async correctness, dependency injection, Pydantic schemas
- `/ecc:python-review` — Run Python code review
