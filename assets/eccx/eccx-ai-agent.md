---
name: eccx-ai-agent
description: "Run a full AI Agent plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-ai-agent — AI Agent

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: agent harnesses, loops, evals, prompts, context and token economy.

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
- `agent-architecture-audit` — Full-stack diagnostic for agent and LLM applications
- `agent-eval` — Head-to-head comparison of coding agents (Claude Code, Aider, Codex, etc.) on custom
- `agent-harness-construction` — Design and optimize AI agent action spaces and tool definitions
- `agent-introspection-debugging` — Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery
- `agent-payment-x402` — Add x402 payment execution to AI agents with per-task budgets, spending controls
- `agent-runtime-gateway-smoke-test` — Verify a local agent API, temporary gateway tunnel, and remote sandbox callback
- `agent-self-evaluation` — . The agent self-rates its output on 5 axes
- `agent-sort` — Build an evidence-backed ECC install plan for a specific repo by sorting
- `agentic-engineering` — Eval-first execution, decomposition, and cost-aware model routing
- `agentic-os` — Build persistent multi-agent operating systems on Claude Code
- `ai-first-engineering` — Operating model for teams where AI agents generate implementation output
- `skill://ai-microservice-design` — An LLM gateway, RAG retrieval, an agent/tool-use loop, per-member keys + usage
- `autonomous-agent-harness` — Transform Claude Code into a fully autonomous agent system with persistent memory
- `autonomous-loops` — Patterns for autonomous Claude Code loops from sequential to multi-agent DAGs
- `skill://autoresearch` — Owner-started, bounded experiment loop against a measurable target
- `benchmark-optimization-loop` — Convert 'make it faster' requests into a bounded measured optimization loop
- `ck` — Persistent per-project memory for Claude Code (Context Keeper) driven by deterministic Node.js
- `claude-devfleet` — Orchestrate multi-agent coding tasks via Claude DevFleet
- `config-gc` — Garbage collection for your Claude Code configuration
- `context-and-decisions` — Govern stable domain context with a narrowly scoped CONTEXT.md when
- `context-budget` — Routes live context checks to the native Codex or Claude Code meter
- `continuous-agent-loop` — Quality gates, evals, and recovery controls for continuous agent loops
- `cost-aware-llm-pipeline` — Model routing by complexity, budget tracking, retry logic, and prompt caching
- `cost-tracking` — Track and report Claude Code token usage, spending, and budgets
- `data-scraper-agent` — Build a fully automated AI-powered data collection agent for any public source
- `deepseek-harness-setup` — Install and operate Everything Claude Code (ECC) on the DeepSeek Harness (DSH)
- `dynamic-workflow-mode` — Design task-local harnesses, eval gates, and reusable skill extraction for Claude dynamic
- `ecc-tools-cost-audit` — Evidence-first ECC Tools burn and billing audit workflow
- `enterprise-agent-ops` — Operational controls for long-lived or cloud-hosted agent systems
- `foundation-models-on-device` — Patterns for running foundation models on-device with edge inference
- `gan-style-harness` — GAN-inspired Generator-Evaluator agent harness for building high-quality applications autonomously
- `hermes-imports` — Convert local Hermes operator workflows into sanitized ECC skills and release-pack artifacts
- `hookify-rules` — Create and configure hookify rules
- `loop-design-check` — Design a goal-oriented agent loop or review one for failure modes: spinning
- `mcp-server-patterns` — Build MCP servers with Node/TypeScript SDK
- `nasiko-control-plane` — Manage the experimental Nasiko CLI lifecycle through ECC
- `openclaw-persona-forge` — 为 OpenClaw AI Agent 锻造完整的龙虾灵魂方案。根据用户偏好或随机抽卡， 输出身份定位、灵魂描述(SOUL.md)、角色化底线规则、名字和头像生图提示词。 如当前环境提供已审核的生图 skill，可自动生成统一风格头像图片。 当用户需要创建、设计或定制 OpenClaw 龙虾灵魂时使用。 不适用于：微调已有
- `opensource-pipeline` — Open-source pipeline: fork, sanitize, and package private projects for safe public release
- `prompt-caching-strategy` — Optimize LLM prompt caching hit rate to reduce API costs and improve
- `prompt-optimizer` — Optimize prompts for better quality, lower cost, and faster responses
- `recursive-decision-ledger` — Run repeated rollouts ("Prime Gauss" style recursive prompting) while keeping an append-only
- `rules-distill` — Scan skills to extract cross-cutting principles and distill them into rules
- `skill-comply` — Visualize whether skills, rules, and agent definitions are actually followed
- `skill-host-compat` — Lint ECC skills for Codex/Cursor-safe frontmatter and Claude-only substitutions before a skill
- `skill-scout` — Search existing local, marketplace, GitHub, and web skill sources before creating
- `team-agent-orchestration` — Run team-based orchestration for agent squads: work items with owners and scope
- `team-builder` — Interactive picker that discovers available agent personas via the claude agents command
- `token-budget-advisor` — Offer a choice of response depth (25%/50%/75%/100%) with token estimates before answering
- `token-card` — Render a token-usage stat card from local Claude Code, Codex, Gemini CLI
- `unified-memory` — Share durable, inspectable context and handoffs between Claude, Codex, Hermes, Cursor, OpenCode

## Agents
- `agent-evaluator` — Evaluates agent output against 5-axis quality rubric (accuracy, completeness, clarity, actionability, conciseness)
- `conversation-analyzer` — Use this agent when analyzing conversation transcripts to find behaviors worth preventing
- `gan-evaluator` — GAN Harness
- `gan-generator` — GAN Harness
- `gan-planner` — GAN Harness
- `harness-optimizer` — Analyze and improve local agent harness configuration
- `loop-operator` — Operate autonomous agent loops and intervene when loops stall
- `rag-pipeline-reviewer` — Reviews RAG (Retrieval-Augmented Generation) pipelines for retrieval quality, chunking strategy, embedding choices

## Commands
- `cost-report` — Generate a local Claude Code cost report from the ECC cost-tracker metrics
- `evolve` — Evolve instincts into skills and commands
- `gan-build` — Run a generator/evaluator build loop for implementation tasks with bounded iterations
- `harness-audit` — Audit harness configuration for issues
- `hookify` — Create hooks to prevent unwanted behaviors from conversation analysis or explicit instructions
- `hookify-configure` — Enable or disable hookify rules interactively
- `hookify-help` — Get help with the hookify system
- `hookify-list` — List all configured hookify rules
- `instinct-export` — Export learned instincts to portable format
- `instinct-import` — Import instincts from exported format
- `instinct-status` — Check status of learned instincts
- `learn` — Trigger learning from current session
- `learn-eval` — Evaluate learned instincts for quality
- `loop-start` — Start an autonomous agent loop
- `loop-status` — Check status of running agent loops
- `model-route` — Route tasks to optimal model by complexity
- `multi-backend` — Backend tasks across multiple agents
- `multi-execute` — Execute tasks across multiple agents
- `multi-frontend` — Frontend tasks across multiple agents
- `multi-plan` — Plan across multiple agents or repos
- `multi-workflow` — Workflow orchestration across agents
- `promote` — Promote an instinct to a full skill
- `prune` — Delete pending instincts older than 30 days that were never promoted
- `skill-health` — Show skill portfolio health dashboard with charts and analytics
- `skill-host-compat` — Lint ECC skills for Codex/Cursor-safe frontmatter and Claude-only substitutions before a skill
- `token-card` — Render a token-usage stat card from local agent session logs and commit
