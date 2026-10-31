---
description: "Run a full Workflow plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-workflow — Workflow

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: plan, build, test, review, refactor, ship — the engineering loop.

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
- `ecc:ai-regression-testing` — Regression testing strategies for AI-assisted development
- `ecc:architecture-decision-records` — Capture architectural decisions as numbered ADR markdown files in docs/adr/ with context
- `autopilot` — Unattended backlog runner, level 5
- `ecc:benchmark` — Measure performance baselines and detect regressions across browser Core Web Vitals
- `ecc:blueprint` — Turn objectives into step-by-step construction plans for multi-session projects
- `branch-sync` — Check, deep-preview, merge to main, and sync all git branches cleanly
- `ecc:brownfield-retrospective` — Run the ECC engineering process retroactively against an existing project slice
- `ecc:browser-qa` — Run automated post-deploy UI verification with a browser automation MCP
- `ecc:change-impact` — Perform evidence-backed impact analysis before changing code, data, interfaces, or governance documents
- `ecc:click-path-audit` — Trace every user-facing button/touchpoint through its full state change sequence to find
- `ecc:code-tour` — Create CodeTour .tour files
- `ecc:codebase-onboarding` — Analyze an unfamiliar codebase and generate a structured onboarding guide with architecture
- `ecc:codehealth-mcp` — Real-time structural Code Health via CodeScene MCP
- `ecc:content-hash-cache-pattern` — SHA-256 content hash caching for expensive file processing
- `ecc:conventional-commit-review` — Reviews staged changes and drafts a Conventional Commits-compliant commit message
- `ecc:council` — Convene a four-voice council for ambiguous decisions, tradeoffs, and go/no-go calls
- `ecc:council-multi-model` — Add one optional external Codex critique after the existing council has produced
- `ecc:database-migrations` — Schema changes, data migrations, rollbacks, and zero-downtime deployments
- `ecc:delivery-gate` — Stop hook that blocks Claude from finishing until quality checks pass
- `ecc:deployment-patterns` — CI/CD pipelines, Docker, health checks, rollback strategies, and production readiness
- `ecc:dev-team` — Simulate a collaborative dev team session where multiple role-based personas
- `ecc:dmux-workflows` — Multi-agent orchestration using dmux for parallel agent sessions
- `do` — Quick small change, level 1
- `ecc:docker-patterns` — Multi-stage builds, Compose, health checks, and container best practices
- `ecc:docs-governance` — Route broad documentation-governance requests to existing ECC skills and run an opt-in
- `ecc:e2e-testing` — Playwright E2E testing patterns, Page Object Model, configuration, CI/CD integration, artifact management
- `ecc:error-handling` — Patterns for robust error handling across TypeScript, Python, and Go
- `ecc:eval-harness` — Evaluation harness for testing agent outputs and scoring results
- `feature` — Quản lý feature LỚN nhiều phase, nhiều ngày, xuyên session
- `full-flow` — "làm full flow", "fix theo flow chuẩn", "dev + verify", "tự chạy
- `ecc:git-workflow` — Git workflow patterns including branching strategies, commit conventions, keeping history clean
- `ecc:github-ops` — GitHub repository operations, automation, and management
- `ecc:growth-log` — Write growth log entries that extract reusable patterns from completed work
- `ecc:inherit-legacy-style` — Prevent AI style drift on legacy projects by scanning the codebase
- `ecc:intent-driven-development` — Turn ambiguous or high-impact product and engineering changes into scoped, verifiable acceptance
- `ecc:jira-integration` — Analyzing requirements, updating ticket status, adding comments, or transitioning issues
- `ecc:living-docs-governance` — Keep a long-lived project's documentation from rotting by assigning existing project docs
- `ecc:module-regression` — Govern cross-module regression in large repositories with a REGRESSION.md ledger that records
- `ecc:orch-add-feature` — Orchestrate building a brand-new feature end to end
- `ecc:orch-build-mvp` — Orchestrate bootstrapping a working MVP from a design or spec document
- `ecc:orch-change-feature` — Orchestrate altering an existing, working feature to new desired behavior
- `ecc:orch-fix-defect` — Orchestrate fixing a bug
- `ecc:orch-pipeline` — Shared orchestration engine behind the orch-* skill family
- `ecc:orch-refine-code` — Orchestrate a behavior-preserving refactor
- `ecc:parallel-execution-optimizer` — Speed up a task by turning it into a dependency graph
- `ecc:plan-canvas` — Open plans and HTML artifacts in a local browser canvas where
- `ecc:plan-orchestrate` — Read a plan document, decompose it into steps, classify each
- `planning` — Lập plan cho một task/feature trước khi code
- `ecc:product-capability` — Translate PRD intent, roadmap asks, or product discussions into an implementation-ready capability
- `ecc:product-lens` — Validate the why before building through four product diagnostics
- `ecc:production-audit` — Local-evidence production readiness audit for shipped apps, pre-launch reviews, post-merge
- `ecc:project-flow-ops` — Operate execution flow across GitHub and Linear by triaging issues and pull
- `ecc:santa-method` — Multi-agent adversarial verification: two independent reviewers with the same rubric must both
- `ship` — Chạy trọn quy trình một feature/bug như một team
- `ship-auto` — Auto ship through release, level 3
- `ship-loop` — Goal loop until acceptance criteria pass, level 4
- `ship-tick` — One iteration of an OPEN loop the owner already started
- `ecc:story-lifecycle` — Manage a file-based epic → story → sprint development loop without requiring
- `sysdesign` — System design for a real change
- `ecc:tdd-workflow` — Test-driven development patterns and workflow enforcement
- `ecc:terminal-ops` — Evidence-first repo execution workflow for ECC. Use when the user wants
- `ecc:test-collaboration` — Inventory and govern a project's test assets
- `ecc:verification-loop` — Structured verification loop for code quality, tests, and deployment readiness
- `ecc:windows-desktop-e2e` — E2E testing for Windows native desktop apps (WPF, WinForms, Win32/MFC, Qt) using

## Agents
- `ecc:architect` — System design, scalability, and architectural decisions
- `ecc:build-error-resolver` — Build and TypeScript error resolution with minimal diffs
- `ecc:code-architect` — Designs feature architectures by analyzing existing codebase patterns and conventions, then providing
- `ecc:code-explorer` — Deeply analyzes existing codebase features by tracing execution paths, mapping architecture layers
- `ecc:code-reviewer` — Code review for quality, security, and maintainability
- `ecc:code-simplifier` — Simplifies and refines code for clarity, consistency, and maintainability while preserving behavior
- `ecc:comment-analyzer` — Analyze code comments for accuracy, completeness, maintainability, and comment rot risk
- `ecc:commit-reviewer` — Reviews a staged diff and drafts a Conventional Commits-compliant message matching
- `ecc:doc-updater` — Documentation and codemap generation and updates
- `ecc:e2e-runner` — End-to-end testing with Playwright, screenshots, and traces
- `ecc:performance-optimizer` — Performance analysis and optimization specialist
- `ecc:planner` — Implementation planning for complex features and refactoring
- `ecc:pr-test-analyzer` — Review pull request test coverage quality and completeness, with emphasis on behavioral
- `ecc:refactor-cleaner` — Dead code cleanup with knip, depcheck, and ts-prune
- `ecc:silent-failure-hunter` — Review code for silent failures, swallowed errors, bad fallbacks, and missing error
- `ecc:spec-miner` — Extracts behavioral specs from existing codebases for OpenSpec
- `ecc:tdd-guide` — Test-driven development enforcement with 80%+ coverage
- `ecc:type-design-analyzer` — Analyze type design for encapsulation, invariant expression, usefulness, and enforcement

## Commands
- `/ecc:aside` — Quick side task without losing main context
- `/ecc:astra-review` — Send Claude-written code to GPT-6-Astra (ChatGPT, via Codex CLI) for an independent
- `/ecc:build-fix` — Fix build errors automatically
- `/ecc:checkpoint` — Create a checkpoint of current work state
- `/ecc:code-review` — Run code review on recent changes
- `/ecc:epic-claim` — Claim an epic issue, stamp coordination state, and sync local ownership
- `/ecc:epic-decompose` — Break an epic into task children without creating task branches
- `/ecc:epic-publish` — Publish a validated epic update back to the issue and local cache
- `/ecc:epic-review` — Mark epic review requested, approved, or changes requested
- `/ecc:epic-sync` — Sync epic issue bodies, labels, and local coordination snapshots from GitHub
- `/ecc:epic-unblock` — Sweep blocked epic issues and reopen anything whose dependencies are closed
- `/ecc:epic-validate` — Validate epic readiness, dependencies, and coordination policy
- `/ecc:feature-dev` — Guided feature development with codebase understanding and architecture focus
- `/ecc:jira` — Retrieve a Jira ticket, analyze requirements, update status, or add comments
- `/ecc:orch-add-feature` — Orchestrate building a brand-new feature end to end
- `/ecc:orch-build-mvp` — Orchestrate bootstrapping a working MVP from a design/spec doc
- `/ecc:orch-change-feature` — Orchestrate altering an existing, working feature to new desired behavior
- `/ecc:orch-fix-defect` — Orchestrate fixing a bug
- `/ecc:orch-refine-code` — Orchestrate a behavior-preserving refactor
- `/ecc:orch-review` — Run the orch-review native Workflow over a diff
- `/ecc:plan` — Create step-by-step implementation plans
- `/ecc:plan-canvas` — Open a plan or HTML artifact in the browser Plan Canvas
- `/ecc:plan-prd` — Generate a lean, problem-first PRD and hand off to /plan for implementation
- `/ecc:pr` — Create a GitHub PR from current branch with unpushed commits
- `/ecc:projects` — Manage multi-project workspaces
- `/ecc:prp-commit` — Quick commit with natural language file targeting
- `/ecc:prp-implement` — Execute an implementation plan with rigorous validation loops
- `/ecc:prp-plan` — Create comprehensive feature implementation plan with codebase analysis and pattern extraction
- `/ecc:prp-pr` — Alias of /pr for the PRP workflow series
- `/ecc:prp-prd` — Interactive PRD generator - problem-first, hypothesis-driven product spec with back-and-forth questioning
- `/ecc:refactor-clean` — Clean up dead code and consolidate
- `/ecc:resume-session` — Resume a previously saved session
- `/ecc:review-pr` — Comprehensive PR review using specialized agents (code-reviewer, comment-analyzer, pr-test-analyzer, silent-failure-hunter, type-design-analyzer, code-simplifier)
- `/ecc:santa-loop` — Adversarial dual-review convergence loop
- `/ecc:save-session` — Save current session for later resume
- `/ecc:sessions` — List and manage saved sessions
- `/ecc:setup-pm` — Set up package manager configuration
- `/ecc:skill-create` — Create a new skill from a template
- `/ecc:test-coverage` — Check and report test coverage
- `/ecc:update-codemaps` — Generate or update codemap files
- `/ecc:update-docs` — Update documentation files
