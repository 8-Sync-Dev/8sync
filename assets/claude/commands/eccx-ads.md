---
description: "Run a full Ads & Marketing plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-ads — Ads & Marketing

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: campaigns, ads, social, SEO, brand, content distribution, lead gen.

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
- `ecc:article-writing` — Long-form content, guides, blog posts, and tutorials with voice consistency
- `assp-skill` — Brand DNA + ASSP validation framework for 8 Sync Dev
- `ecc:benchmark-methodology` — Score a scoped competitor set into comparable profile cards: nine weighted dimensions
- `ecc:brand-discovery` — Run a structured, resumable multi-session brand identity interview across 8 modules
- `ecc:brand-voice` — Build a source-derived writing style profile from real posts, essays, launch notes
- `ecc:competitive-platform-analysis` — Identifying, categorising, and score-filtering a competitor set before any benchmarking begins
- `ecc:competitive-report-structure` — Assemble scored competitor profile cards (from benchmark-methodology) into a decision-grade competitive report
- `ecc:connections-optimizer` — Reorganize the user's X and LinkedIn network with review-first pruning, add/follow recommendations
- `ecc:content-engine` — Multi-platform content systems for X, LinkedIn, TikTok, YouTube, and newsletters
- `ecc:crosspost` — Multi-platform distribution across X, LinkedIn, Threads, and Bluesky
- `ecc:fal-ai-media` — Fal.ai media generation integration for images, video, and audio
- `image-gen` — Generate AI images, icons, logos, diagrams, illustrations, and mockups via gpt-image-2 using
- `ecc:investor-materials` — Pitch decks, financial models, and investor-facing documents
- `ecc:investor-outreach` — Investor pipeline management, outreach sequences, and follow-ups
- `last30days` — "research <topic> recently", "what's trending on Reddit/X/YouTube about Y", pre-meeting/pre-call briefings, "last
- `ecc:lead-intelligence` — AI-native lead intelligence and outreach pipeline
- `ecc:manim-video` — Build reusable Manim explainers for technical concepts, graphs, system diagrams, and product
- `ecc:market-research` — Market analysis, competitive intelligence, and industry research
- `ecc:marketing-campaign` — End-to-end marketing campaign planning and execution
- `ecc:remotion-video-creation` — Best practices for Remotion - Video creation in React
- `ecc:seo` — Audit, plan, and implement SEO improvements across technical SEO, on-page optimization, structured
- `ecc:social-graph-ranker` — Weighted social-graph ranking for warm intro discovery, bridge scoring, and network gap
- `social-growth` — OPT-IN (không auto-bật)
- `ecc:social-publisher` — Agent-driven scheduling and publishing of social media posts across 13 platforms
- `ecc:taste` — Creative-direction layer for music videos and short-form edits in the angelcore /
- `ecc:taste-application` — Generate new video against a distilled style pack and cut it
- `ecc:taste-distillation` — Measure a set of reference videos into a reusable style pack
- `ecc:tasteforge-video` — Video, and 3D-asset discovery
- `ecc:ui-demo` — Record polished UI demo videos using Playwright
- `ecc:video-editing` — Video editing automation and processing patterns
- `ecc:videodb` — VideoDB integration for video search and analysis
- `ecc:x-api` — X (Twitter) API integration patterns and automation

## Agents
- `ecc:marketing-agent` — Marketing strategist and copywriter for campaign planning, audience research, positioning, copy creation
- `ecc:seo-specialist` — SEO specialist for technical SEO audits, on-page optimization, structured data, Core Web

## Commands
- `/ecc:marketing-campaign` — Plan and execute a full marketing campaign
