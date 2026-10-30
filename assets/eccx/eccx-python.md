---
name: eccx-python
description: "Run a full Python plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-python — Python

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: Python, Django, FastAPI, PyTorch, ML engineering.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `<ECC>` = 8sync's pinned ECC checkout `~/.cache/8sync/ecc/` (made by `8sync harness`), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` = 8sync skill; plain name = ECC skill: `skill://<name>` if it resolves, else read `<ECC>/skills/<name>/SKILL.md`.
- Agents: spawn a `task` subagent whose prompt opens with the role file `<ECC>/agents/<agent>.md`.
- Commands: read `<ECC>/commands/<cmd>.md` and follow it with that step's arguments.
- A member that does not resolve: skip it, say so.

## Skills
- `django-celery` — Django + Celery async task patterns
- `django-patterns` — Django architecture, DRF, ORM best practices, and caching
- `django-tdd` — Django testing with pytest-django, factory_boy, and coverage
- `django-verification` — Django verification loop: migrations, linting, tests, and security scans
- `fastapi-patterns` — FastAPI best practices covering project structure, Pydantic v2 schemas, dependency injection, async
- `generating-python-installer` — Commercial-grade Python installer expert for Windows: Nuitka extreme compilation, dist slimming, DLL
- `ml-adoption-playbook` — End-to-end methodology for AI agents and software engineers to add machine learning
- `mle-workflow` — Production machine-learning engineering workflow for data contracts, reproducible training, model evaluation, deployment
- `python-patterns` — Pythonic idioms, type hints, async patterns, and project structure
- `python-testing` — Pytest patterns, fixtures, mocking, and coverage configuration
- `pytorch-patterns` — PyTorch deep learning patterns and best practices for building
- `recsys-pipeline-architect` — Design composable recommendation, ranking, and feed pipelines using the six-stage Source→Hydrator→Filter→Scorer→Selector→SideEffect framework

## Agents
- `django-build-resolver` — Django/Python build, migration, and dependency error resolution specialist
- `django-reviewer` — Expert Django code reviewer specializing in ORM correctness, DRF patterns, migration safety
- `fastapi-reviewer` — Reviews FastAPI applications for async correctness, dependency injection, Pydantic schemas, security, OpenAPI
- `mle-reviewer` — Production machine-learning engineering reviewer for data contracts, feature pipelines, training reproducibility, offline/online
- `python-reviewer` — Python code review for PEP 8, type hints, and security
- `pytorch-build-resolver` — PyTorch runtime, CUDA, and training error resolution specialist

## Commands
- `fastapi-review` — Review a FastAPI application for architecture, async correctness, dependency injection, Pydantic schemas
- `python-review` — Run Python code review
