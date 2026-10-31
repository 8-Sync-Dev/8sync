---
description: "Run a full AI Agent plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-ai-agent — AI Agent

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: agent harnesses, loops, evals, prompts, context and token economy.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:agent-architecture-audit` — Full-stack diagnostic for agent and LLM applications
- `ecc:agent-eval` — Head-to-head comparison of coding agents (Claude Code, Aider, Codex, etc.) on custom
- `ecc:agent-harness-construction` — Design and optimize AI agent action spaces and tool definitions
- `ecc:agent-introspection-debugging` — Structured self-debugging workflow for AI agent failures using capture, diagnosis, contained recovery
- `ecc:agent-payment-x402` — Add x402 payment execution to AI agents with per-task budgets, spending controls
- `ecc:agent-runtime-gateway-smoke-test` — Verify a local agent API, temporary gateway tunnel, and remote sandbox callback
- `ecc:agent-self-evaluation` — . The agent self-rates its output on 5 axes
- `ecc:agent-sort` — Build an evidence-backed ECC install plan for a specific repo by sorting
- `ecc:agentic-engineering` — Eval-first execution, decomposition, and cost-aware model routing
- `ecc:agentic-os` — Build persistent multi-agent operating systems on Claude Code
- `ecc:ai-first-engineering` — Operating model for teams where AI agents generate implementation output
- `ai-microservice-design` — An LLM gateway, RAG retrieval, an agent/tool-use loop, per-member keys + usage
- `ecc:autonomous-agent-harness` — Transform Claude Code into a fully autonomous agent system with persistent memory
- `ecc:autonomous-loops` — Patterns for autonomous Claude Code loops from sequential to multi-agent DAGs
- `autoresearch` — Owner-started, bounded experiment loop against a measurable target
- `ecc:benchmark-optimization-loop` — Convert 'make it faster' requests into a bounded measured optimization loop
- `ecc:ck` — Persistent per-project memory for Claude Code (Context Keeper) driven by deterministic Node.js
- `ecc:claude-devfleet` — Orchestrate multi-agent coding tasks via Claude DevFleet
- `ecc:config-gc` — Garbage collection for your Claude Code configuration
- `ecc:context-and-decisions` — Govern stable domain context with a narrowly scoped CONTEXT.md when
- `ecc:context-budget` — Routes live context checks to the native Codex or Claude Code meter
- `ecc:continuous-agent-loop` — Quality gates, evals, and recovery controls for continuous agent loops
- `ecc:cost-aware-llm-pipeline` — Model routing by complexity, budget tracking, retry logic, and prompt caching
- `ecc:cost-tracking` — Track and report Claude Code token usage, spending, and budgets
- `ecc:data-scraper-agent` — Build a fully automated AI-powered data collection agent for any public source
- `ecc:deepseek-harness-setup` — Install and operate Everything Claude Code (ECC) on the DeepSeek Harness (DSH)
- `ecc:dynamic-workflow-mode` — Design task-local harnesses, eval gates, and reusable skill extraction for Claude dynamic
- `ecc:ecc-tools-cost-audit` — Evidence-first ECC Tools burn and billing audit workflow
- `ecc:enterprise-agent-ops` — Operational controls for long-lived or cloud-hosted agent systems
- `ecc:foundation-models-on-device` — Patterns for running foundation models on-device with edge inference
- `ecc:gan-style-harness` — GAN-inspired Generator-Evaluator agent harness for building high-quality applications autonomously
- `ecc:hermes-imports` — Convert local Hermes operator workflows into sanitized ECC skills and release-pack artifacts
- `ecc:hookify-rules` — Create and configure hookify rules
- `ecc:loop-design-check` — Design a goal-oriented agent loop or review one for failure modes: spinning
- `ecc:mcp-server-patterns` — Build MCP servers with Node/TypeScript SDK
- `ecc:nasiko-control-plane` — Manage the experimental Nasiko CLI lifecycle through ECC
- `ecc:openclaw-persona-forge` — 为 OpenClaw AI Agent 锻造完整的龙虾灵魂方案。根据用户偏好或随机抽卡， 输出身份定位、灵魂描述(SOUL.md)、角色化底线规则、名字和头像生图提示词。 如当前环境提供已审核的生图 skill，可自动生成统一风格头像图片。 当用户需要创建、设计或定制 OpenClaw 龙虾灵魂时使用。 不适用于：微调已有
- `ecc:opensource-pipeline` — Open-source pipeline: fork, sanitize, and package private projects for safe public release
- `ecc:prompt-caching-strategy` — Optimize LLM prompt caching hit rate to reduce API costs and improve
- `ecc:prompt-optimizer` — Optimize prompts for better quality, lower cost, and faster responses
- `ecc:recursive-decision-ledger` — Run repeated rollouts ("Prime Gauss" style recursive prompting) while keeping an append-only
- `ecc:rules-distill` — Scan skills to extract cross-cutting principles and distill them into rules
- `ecc:skill-comply` — Visualize whether skills, rules, and agent definitions are actually followed
- `ecc:skill-host-compat` — Lint ECC skills for Codex/Cursor-safe frontmatter and Claude-only substitutions before a skill
- `ecc:skill-scout` — Search existing local, marketplace, GitHub, and web skill sources before creating
- `ecc:team-agent-orchestration` — Run team-based orchestration for agent squads: work items with owners and scope
- `ecc:team-builder` — Interactive picker that discovers available agent personas via the claude agents command
- `ecc:token-budget-advisor` — Offer a choice of response depth (25%/50%/75%/100%) with token estimates before answering
- `ecc:token-card` — Render a token-usage stat card from local Claude Code, Codex, Gemini CLI
- `ecc:unified-memory` — Share durable, inspectable context and handoffs between Claude, Codex, Hermes, Cursor, OpenCode

## Agents
- `ecc:agent-evaluator` — Evaluates agent output against 5-axis quality rubric (accuracy, completeness, clarity, actionability, conciseness)
- `ecc:conversation-analyzer` — Use this agent when analyzing conversation transcripts to find behaviors worth preventing
- `ecc:gan-evaluator` — GAN Harness
- `ecc:gan-generator` — GAN Harness
- `ecc:gan-planner` — GAN Harness
- `ecc:harness-optimizer` — Analyze and improve local agent harness configuration
- `ecc:loop-operator` — Operate autonomous agent loops and intervene when loops stall
- `ecc:rag-pipeline-reviewer` — Reviews RAG (Retrieval-Augmented Generation) pipelines for retrieval quality, chunking strategy, embedding choices

## Commands
- `/ecc:cost-report` — Generate a local Claude Code cost report from the ECC cost-tracker metrics
- `/ecc:evolve` — Evolve instincts into skills and commands
- `/ecc:gan-build` — Run a generator/evaluator build loop for implementation tasks with bounded iterations
- `/ecc:harness-audit` — Audit harness configuration for issues
- `/ecc:hookify` — Create hooks to prevent unwanted behaviors from conversation analysis or explicit instructions
- `/ecc:hookify-configure` — Enable or disable hookify rules interactively
- `/ecc:hookify-help` — Get help with the hookify system
- `/ecc:hookify-list` — List all configured hookify rules
- `/ecc:instinct-export` — Export learned instincts to portable format
- `/ecc:instinct-import` — Import instincts from exported format
- `/ecc:instinct-status` — Check status of learned instincts
- `/ecc:learn` — Trigger learning from current session
- `/ecc:learn-eval` — Evaluate learned instincts for quality
- `/ecc:loop-start` — Start an autonomous agent loop
- `/ecc:loop-status` — Check status of running agent loops
- `/ecc:model-route` — Route tasks to optimal model by complexity
- `/ecc:multi-backend` — Backend tasks across multiple agents
- `/ecc:multi-execute` — Execute tasks across multiple agents
- `/ecc:multi-frontend` — Frontend tasks across multiple agents
- `/ecc:multi-plan` — Plan across multiple agents or repos
- `/ecc:multi-workflow` — Workflow orchestration across agents
- `/ecc:promote` — Promote an instinct to a full skill
- `/ecc:prune` — Delete pending instincts older than 30 days that were never promoted
- `/ecc:skill-health` — Show skill portfolio health dashboard with charts and analytics
- `/ecc:skill-host-compat` — Lint ECC skills for Codex/Cursor-safe frontmatter and Claude-only substitutions before a skill
- `/ecc:token-card` — Render a token-usage stat card from local agent session logs and commit
