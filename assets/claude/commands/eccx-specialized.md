---
description: "Run a full Specialized plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-specialized — Specialized

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: operator tools, media, desks, homelab, niche domains.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- `ecc:` members: plugin `ecc@ecc` on → Skill tool / `subagent_type` / `/ecc:<cmd>`; off (saves ~9k tokens a call) → read `<ECC>/skills/<name>/SKILL.md`, a `general-purpose` agent opening with `<ECC>/agents/<agent>.md`, `<ECC>/commands/<cmd>.md`. `<ECC>` = newest `~/.claude/plugins/cache/ecc/ecc/*/`. Plain name = 8sync skill (Skill tool).
- One session: parallel members = Agent calls in one message or one Workflow, no sub-sessions. Unresolved member: skip it, say so.

## Skills
- `ecc:automation-audit-ops` — Evidence-first automation inventory and overlap audit workflow for ECC. Use when
- `ecc:bengali-nlp` — Bengali (Bangla) text processing patterns including Unicode normalization, script detection, tokenization, conjunct
- `ecc:blender-motion-state-inspection` — Rigs, poses, animation retargeting, ground contact, facing direction, or model-vs-motion alignment where
- `clean` — Dọn rác dev trên máy
- `ecc:counterparty-channel-discipline` — Per-channel strict prompts, mention gating, silent observation, and a communication autonomy policy
- `ecc:customer-billing-ops` — Operate customer billing workflows such as subscriptions, refunds, churn triage, billing-portal recovery
- `ecc:dashboard-builder` — Build monitoring dashboards that answer real operator questions
- `ecc:email-ops` — Evidence-first mailbox triage, drafting, send verification, and sent-mail-safe follow-up workflow for ECC
- `ecc:fal-ai-media` — Fal.ai media generation integration for images, video, and audio
- `ecc:finance-billing-ops` — Evidence-first revenue, pricing, refunds, team-billing, and billing-model truth workflow for ECC. Use
- `ecc:google-workspace-ops` — Operate across Google Drive, Docs, Sheets, and Slides as one workflow surface
- `ecc:ito-baskets` — Read-only Itô basket and prediction-market data skill
- `ecc:ito-compute` — Query live GPU inventory, submit an authenticated Itô fixed-rate RFQ, inspect RFQ
- `ecc:ito-inference` — Inspect the availability of model serving on a completed Itô compute booking
- `ecc:ito-training` — Inspect the availability of ML training on a completed Itô compute booking
- `ecc:knowledge-ops` — Knowledge base management, ingestion, sync, and retrieval across multiple storage layers
- `locate-anything` — Fast open-vocabulary VISUAL GROUNDING via NVIDIA LocateAnything-3B
- `ecc:mailtrap-email-integration` — Guides agents through integrating transactional email sending via Mailtrap's Email API, including
- `ecc:manim-video` — Build reusable Manim explainers for technical concepts, graphs, system diagrams, and product
- `ecc:messages-ops` — Evidence-first live messaging workflow for ECC. Use when the user wants
- `ecc:nanoclaw-repl` — Nanoclaw REPL patterns for interactive agent sessions
- `ecc:nutrient-document-processing` — Document processing with Nutrient SDK for PDFs and forms
- `ecc:operator-approval-loop` — Operator approval contract with internal filing notices for agent-drafted outbound messages, hashed
- `ecc:plankton-code-quality` — Code quality analysis and metrics tracking
- `ecc:prediction-market-oracle-research` — Research prediction markets as data sources or oracle signals for products, agents
- `ecc:prediction-market-risk-review` — Review prediction-market, basket, oracle, and trading-agent workflows for compliance, safety, data-quality, privacy
- `ecc:ralphinho-rfc-pipeline` — RFC-driven development pipeline for structured proposals
- `ecc:regex-vs-llm-structured-text` — Decision framework for regex vs LLM-based text extraction
- `ecc:remotion-video-creation` — Best practices for Remotion - Video creation in React
- `ecc:skill-stocktake` — Audit and inventory installed skills across harness configurations
- `ecc:taste` — Creative-direction layer for music videos and short-form edits in the angelcore /
- `ecc:taste-application` — Generate new video against a distilled style pack and cut it
- `ecc:taste-distillation` — Measure a set of reference videos into a reusable style pack
- `ecc:tasteforge-video` — Video, and 3D-asset discovery
- `ecc:ui-demo` — Record polished UI demo videos using Playwright
- `ecc:unified-notifications-ops` — Operate notifications as one ECC-native workflow across GitHub, Linear, desktop alerts, hooks
- `ecc:video-editing` — Video editing automation and processing patterns
- `ecc:videodb` — VideoDB integration for video search and analysis
- `ecc:workspace-surface-audit` — Audit the active repo, MCP servers, plugins, connectors, env surfaces, and harness
- `zai-vision` — FALLBACK only

## Agents
- `ecc:bengali-reviewer` — Reviews code handling Bengali (Bangla) text for Unicode correctness, proper normalization, script-aware
- `ecc:chief-of-staff` — Communication triage across email, Slack, and messaging platforms
- `ecc:harmonyos-app-resolver` — HarmonyOS application development expert specializing in ArkTS and ArkUI. Reviews code
- `ecc:opensource-forker` — Fork any project for open-sourcing
- `ecc:opensource-packager` — Generate complete open-source packaging for a sanitized project

## Commands
- `/ecc:pm2` — PM2 process management integration
