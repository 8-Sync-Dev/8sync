---
name: eccx-ads
description: "Run a full Ads & Marketing plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-ads — Ads & Marketing

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: campaigns, ads, social, SEO, brand, content distribution, lead gen.

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
- `article-writing` — Long-form content, guides, blog posts, and tutorials with voice consistency
- `skill://assp-skill` — Brand DNA + ASSP validation framework for 8 Sync Dev
- `benchmark-methodology` — Score a scoped competitor set into comparable profile cards: nine weighted dimensions
- `brand-discovery` — Run a structured, resumable multi-session brand identity interview across 8 modules
- `brand-voice` — Build a source-derived writing style profile from real posts, essays, launch notes
- `competitive-platform-analysis` — Identifying, categorising, and score-filtering a competitor set before any benchmarking begins
- `competitive-report-structure` — Assemble scored competitor profile cards (from benchmark-methodology) into a decision-grade competitive report
- `connections-optimizer` — Reorganize the user's X and LinkedIn network with review-first pruning, add/follow recommendations
- `content-engine` — Multi-platform content systems for X, LinkedIn, TikTok, YouTube, and newsletters
- `crosspost` — Multi-platform distribution across X, LinkedIn, Threads, and Bluesky
- `fal-ai-media` — Fal.ai media generation integration for images, video, and audio
- `skill://image-gen` — Generate AI images, icons, logos, diagrams, illustrations, and mockups via gpt-image-2 using
- `investor-materials` — Pitch decks, financial models, and investor-facing documents
- `investor-outreach` — Investor pipeline management, outreach sequences, and follow-ups
- `skill://last30days` — "research <topic> recently", "what's trending on Reddit/X/YouTube about Y", pre-meeting/pre-call briefings, "last
- `lead-intelligence` — AI-native lead intelligence and outreach pipeline
- `manim-video` — Build reusable Manim explainers for technical concepts, graphs, system diagrams, and product
- `market-research` — Market analysis, competitive intelligence, and industry research
- `marketing-campaign` — End-to-end marketing campaign planning and execution
- `remotion-video-creation` — Best practices for Remotion - Video creation in React
- `seo` — Audit, plan, and implement SEO improvements across technical SEO, on-page optimization, structured
- `social-graph-ranker` — Weighted social-graph ranking for warm intro discovery, bridge scoring, and network gap
- `skill://social-growth` — OPT-IN (không auto-bật)
- `social-publisher` — Agent-driven scheduling and publishing of social media posts across 13 platforms
- `taste` — Creative-direction layer for music videos and short-form edits in the angelcore /
- `taste-application` — Generate new video against a distilled style pack and cut it
- `taste-distillation` — Measure a set of reference videos into a reusable style pack
- `tasteforge-video` — Video, and 3D-asset discovery
- `ui-demo` — Record polished UI demo videos using Playwright
- `video-editing` — Video editing automation and processing patterns
- `videodb` — VideoDB integration for video search and analysis
- `x-api` — X (Twitter) API integration patterns and automation

## Agents
- `marketing-agent` — Marketing strategist and copywriter for campaign planning, audience research, positioning, copy creation
- `seo-specialist` — SEO specialist for technical SEO audits, on-page optimization, structured data, Core Web

## Commands
- `marketing-campaign` — Plan and execute a full marketing campaign
