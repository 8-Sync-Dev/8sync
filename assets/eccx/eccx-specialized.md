---
name: eccx-specialized
description: "Run a full Specialized plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-specialized — Specialized

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: operator tools, media, desks, homelab, niche domains.

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
- `automation-audit-ops` — Evidence-first automation inventory and overlap audit workflow for ECC. Use when
- `bengali-nlp` — Bengali (Bangla) text processing patterns including Unicode normalization, script detection, tokenization, conjunct
- `blender-motion-state-inspection` — Rigs, poses, animation retargeting, ground contact, facing direction, or model-vs-motion alignment where
- `counterparty-channel-discipline` — Per-channel strict prompts, mention gating, silent observation, and a communication autonomy policy
- `customer-billing-ops` — Operate customer billing workflows such as subscriptions, refunds, churn triage, billing-portal recovery
- `dashboard-builder` — Build monitoring dashboards that answer real operator questions
- `email-ops` — Evidence-first mailbox triage, drafting, send verification, and sent-mail-safe follow-up workflow for ECC
- `fal-ai-media` — Fal.ai media generation integration for images, video, and audio
- `finance-billing-ops` — Evidence-first revenue, pricing, refunds, team-billing, and billing-model truth workflow for ECC. Use
- `google-workspace-ops` — Operate across Google Drive, Docs, Sheets, and Slides as one workflow surface
- `ito-baskets` — Read-only Itô basket and prediction-market data skill
- `ito-compute` — Query live GPU inventory, submit an authenticated Itô fixed-rate RFQ, inspect RFQ
- `ito-inference` — Inspect the availability of model serving on a completed Itô compute booking
- `ito-training` — Inspect the availability of ML training on a completed Itô compute booking
- `knowledge-ops` — Knowledge base management, ingestion, sync, and retrieval across multiple storage layers
- `skill://locate-anything` — Fast open-vocabulary VISUAL GROUNDING via NVIDIA LocateAnything-3B
- `mailtrap-email-integration` — Guides agents through integrating transactional email sending via Mailtrap's Email API, including
- `manim-video` — Build reusable Manim explainers for technical concepts, graphs, system diagrams, and product
- `messages-ops` — Evidence-first live messaging workflow for ECC. Use when the user wants
- `nanoclaw-repl` — Nanoclaw REPL patterns for interactive agent sessions
- `nutrient-document-processing` — Document processing with Nutrient SDK for PDFs and forms
- `operator-approval-loop` — Operator approval contract with internal filing notices for agent-drafted outbound messages, hashed
- `plankton-code-quality` — Code quality analysis and metrics tracking
- `prediction-market-oracle-research` — Research prediction markets as data sources or oracle signals for products, agents
- `prediction-market-risk-review` — Review prediction-market, basket, oracle, and trading-agent workflows for compliance, safety, data-quality, privacy
- `ralphinho-rfc-pipeline` — RFC-driven development pipeline for structured proposals
- `regex-vs-llm-structured-text` — Decision framework for regex vs LLM-based text extraction
- `remotion-video-creation` — Best practices for Remotion - Video creation in React
- `skill-stocktake` — Audit and inventory installed skills across harness configurations
- `taste` — Creative-direction layer for music videos and short-form edits in the angelcore /
- `taste-application` — Generate new video against a distilled style pack and cut it
- `taste-distillation` — Measure a set of reference videos into a reusable style pack
- `tasteforge-video` — Video, and 3D-asset discovery
- `ui-demo` — Record polished UI demo videos using Playwright
- `unified-notifications-ops` — Operate notifications as one ECC-native workflow across GitHub, Linear, desktop alerts, hooks
- `video-editing` — Video editing automation and processing patterns
- `videodb` — VideoDB integration for video search and analysis
- `workspace-surface-audit` — Audit the active repo, MCP servers, plugins, connectors, env surfaces, and harness
- `skill://zai-vision` — FALLBACK only

## Agents
- `bengali-reviewer` — Reviews code handling Bengali (Bangla) text for Unicode correctness, proper normalization, script-aware
- `chief-of-staff` — Communication triage across email, Slack, and messaging platforms
- `harmonyos-app-resolver` — HarmonyOS application development expert specializing in ArkTS and ArkUI. Reviews code
- `opensource-forker` — Fork any project for open-sourcing
- `opensource-packager` — Generate complete open-source packaging for a sanitized project

## Commands
- `pm2` — PM2 process management integration
