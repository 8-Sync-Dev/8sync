---
name: eccx-workflow
description: "Run a full Workflow plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-workflow — Workflow

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: plan, build, test, review, refactor, ship — the engineering loop.

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
- `ai-regression-testing` — Regression testing strategies for AI-assisted development
- `architecture-decision-records` — Capture architectural decisions as numbered ADR markdown files in docs/adr/ with context
- `benchmark` — Measure performance baselines and detect regressions across browser Core Web Vitals
- `blueprint` — Turn objectives into step-by-step construction plans for multi-session projects
- `skill://branch-sync` — Check, deep-preview, merge to main, and sync all git branches cleanly
- `brownfield-retrospective` — Run the ECC engineering process retroactively against an existing project slice
- `browser-qa` — Run automated post-deploy UI verification with a browser automation MCP
- `change-impact` — Perform evidence-backed impact analysis before changing code, data, interfaces, or governance documents
- `click-path-audit` — Trace every user-facing button/touchpoint through its full state change sequence to find
- `code-tour` — Create CodeTour .tour files
- `codebase-onboarding` — Analyze an unfamiliar codebase and generate a structured onboarding guide with architecture
- `codehealth-mcp` — Real-time structural Code Health via CodeScene MCP
- `content-hash-cache-pattern` — SHA-256 content hash caching for expensive file processing
- `conventional-commit-review` — Reviews staged changes and drafts a Conventional Commits-compliant commit message
- `council` — Convene a four-voice council for ambiguous decisions, tradeoffs, and go/no-go calls
- `council-multi-model` — Add one optional external Codex critique after the existing council has produced
- `database-migrations` — Schema changes, data migrations, rollbacks, and zero-downtime deployments
- `delivery-gate` — Stop hook that blocks Claude from finishing until quality checks pass
- `deployment-patterns` — CI/CD pipelines, Docker, health checks, rollback strategies, and production readiness
- `dev-team` — Simulate a collaborative dev team session where multiple role-based personas
- `dmux-workflows` — Multi-agent orchestration using dmux for parallel agent sessions
- `docker-patterns` — Multi-stage builds, Compose, health checks, and container best practices
- `docs-governance` — Route broad documentation-governance requests to existing ECC skills and run an opt-in
- `e2e-testing` — Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management
- `error-handling` — Patterns for robust error handling across TypeScript, Python, and Go
- `eval-harness` — Evaluation harness for testing agent outputs and scoring results
- `skill://feature` — Quản lý feature LỚN nhiều phase, nhiều ngày, xuyên session
- `skill://full-flow` — "làm full flow", "fix theo flow chuẩn", "dev + verify", "tự chạy
- `git-workflow` — Git workflow patterns including branching strategies, commit conventions, keeping history clean
- `github-ops` — GitHub repository operations, automation, and management
- `growth-log` — Write growth log entries that extract reusable patterns from completed work
- `inherit-legacy-style` — Prevent AI style drift on legacy projects by scanning the codebase
- `intent-driven-development` — Turn ambiguous or high-impact product and engineering changes into scoped, verifiable acceptance
- `jira-integration` — Analyzing requirements, updating ticket status, adding comments, or transitioning issues
- `living-docs-governance` — Keep a long-lived project's documentation from rotting by assigning existing project docs
- `module-regression` — Govern cross-module regression in large repositories with a REGRESSION.md ledger that records
- `orch-add-feature` — Orchestrate building a brand-new feature end to end
- `orch-build-mvp` — Orchestrate bootstrapping a working MVP from a design or spec document
- `orch-change-feature` — Orchestrate altering an existing, working feature to new desired behavior
- `orch-fix-defect` — Orchestrate fixing a bug
- `orch-pipeline` — Shared orchestration engine behind the orch-* skill family
- `orch-refine-code` — Orchestrate a behavior-preserving refactor
- `parallel-execution-optimizer` — Speed up a task by turning it into a dependency graph
- `plan-canvas` — Open plans and HTML artifacts in a local browser canvas where
- `plan-orchestrate` — Read a plan document, decompose it into steps, classify each
- `product-capability` — Translate PRD intent, roadmap asks, or product discussions into an implementation-ready capability
- `product-lens` — Validate the why before building through four product diagnostics
- `production-audit` — Local-evidence production readiness audit for shipped apps, pre-launch reviews, post-merge
- `project-flow-ops` — Operate execution flow across GitHub and Linear by triaging issues and pull
- `santa-method` — Multi-agent adversarial verification: two independent reviewers with the same rubric must both
- `story-lifecycle` — Manage a file-based epic → story → sprint development loop without requiring
- `tdd-workflow` — Test-driven development patterns and workflow enforcement
- `terminal-ops` — Evidence-first repo execution workflow for ECC. Use when the user wants
- `test-collaboration` — Inventory and govern a project's test assets
- `verification-loop` — Structured verification loop for code quality, tests, and deployment readiness
- `windows-desktop-e2e` — E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using

## Agents
- `architect` — System design, scalability, and architectural decisions
- `build-error-resolver` — Build and TypeScript error resolution with minimal diffs
- `code-architect` — Designs feature architectures by analyzing existing codebase patterns and conventions, then providing
- `code-explorer` — Deeply analyzes existing codebase features by tracing execution paths, mapping architecture layers
- `code-reviewer` — Code review for quality, security, and maintainability
- `code-simplifier` — Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior
- `comment-analyzer` — Analyze code comments for accuracy, completeness, maintainability, and comment rot risk
- `commit-reviewer` — Reviews a staged diff and drafts a Conventional Commits-compliant message matching
- `doc-updater` — Documentation and codemap generation and updates
- `e2e-runner` — End-to-end testing with Playwright, screenshots, and traces
- `performance-optimizer` — Performance analysis and optimization specialist
- `planner` — Implementation planning for complex features and refactoring
- `pr-test-analyzer` — Review pull request test coverage quality and completeness, with emphasis on behavioral
- `refactor-cleaner` — Dead code cleanup with knip, depcheck, and ts-prune
- `silent-failure-hunter` — Review code for silent failures, swallowed errors, bad fallbacks, and missing error
- `spec-miner` — Extracts behavioral specs from existing codebases for OpenSpec
- `tdd-guide` — Test-driven development enforcement with 80%+ coverage
- `type-design-analyzer` — Analyze type design for encapsulation, invariant expression, usefulness, and enforcement

## Commands
- `aside` — Quick side task without losing main context
- `astra-review` — Send Claude-written code to GPT-6-Astra (ChatGPT, via Codex CLI) for an independent
- `build-fix` — Fix build errors automatically
- `checkpoint` — Create a checkpoint of current work state
- `code-review` — Run code review on recent changes
- `epic-claim` — Claim an epic issue, stamp coordination state, and sync local ownership
- `epic-decompose` — Break an epic into task children without creating task branches
- `epic-publish` — Publish a validated epic update back to the issue and local cache
- `epic-review` — Mark epic review requested, approved, or changes requested
- `epic-sync` — Sync epic issue bodies, labels, and local coordination snapshots from GitHub
- `epic-unblock` — Sweep blocked epic issues and reopen anything whose dependencies are closed
- `epic-validate` — Validate epic readiness, dependencies, and coordination policy
- `feature-dev` — Guided feature development with codebase understanding and architecture focus
- `jira` — Retrieve a Jira ticket, analyze requirements, update status, or add comments
- `orch-add-feature` — Orchestrate building a brand-new feature end to end
- `orch-build-mvp` — Orchestrate bootstrapping a working MVP from a design/spec doc
- `orch-change-feature` — Orchestrate altering an existing, working feature to new desired behavior
- `orch-fix-defect` — Orchestrate fixing a bug
- `orch-refine-code` — Orchestrate a behavior-preserving refactor
- `orch-review` — Run the orch-review native Workflow over a diff
- `plan` — Create step-by-step implementation plans
- `plan-canvas` — Open a plan or HTML artifact in the browser Plan Canvas
- `plan-prd` — Generate a lean, problem-first PRD and hand off to /plan for implementation
- `pr` — Create a GitHub PR from current branch with unpushed commits
- `projects` — Manage multi-project workspaces
- `prp-commit` — Quick commit with natural language file targeting
- `prp-implement` — Execute an implementation plan with rigorous validation loops
- `prp-plan` — Create comprehensive feature implementation plan with codebase analysis and pattern extraction
- `prp-pr` — Alias of /pr for the PRP workflow series
- `prp-prd` — Interactive PRD generator - problem-first, hypothesis-driven product spec with back-and-forth questioning
- `refactor-clean` — Clean up dead code and consolidate
- `resume-session` — Resume a previously saved session
- `review-pr` — Comprehensive PR review using specialized agents (code-reviewer, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, code-simplifier)
- `santa-loop` — Adversarial dual-review convergence loop
- `save-session` — Save current session for later resume
- `sessions` — List and manage saved sessions
- `setup-pm` — Set up package manager configuration
- `skill-create` — Create a new skill from a template
- `test-coverage` — Check and report test coverage
- `update-codemaps` — Generate or update codemap files
- `update-docs` — Update documentation files
