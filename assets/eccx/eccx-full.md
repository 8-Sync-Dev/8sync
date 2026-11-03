---
name: eccx-full
description: "Run a full cross-category plan for a goal using every relevant ECC + 8sync skill across the eccx categories"
argument-hint: "<goal> [--dry-run]"
---

# /eccx-full — route a goal across every relevant category

Goal: `$ARGUMENTS` (`--dry-run` = stop after the merged plan).

**Always (8sync harness):** `skill://trail` STEP 0 before any grep/read of code; `skill://karpathy-guidelines` every code step; `skill://ponytail` pick the simplest plan that works; `skill://8sync-cli` any `8sync` verb (ship, ccc, harness); `skill://impeccable` every UI step.

1. **Route.** From the categories below pick EVERY one relevant to the goal (default to inclusion); one line of why per pick.
2. **Select.** For each pick open `~/.omp/agent/commands/eccx-<cat>.md` and do its Select step on its member lists. Merge into one deduplicated set.
3. **Plan.** One numbered plan (research → design → build → verify → ship/distribute); each step names its skills/agents/commands and its check. `--dry-run`: print it and stop.
4. **Execute** step by step. Read each skill just before its step, never all up front. Independent steps → parallel `task` subagents in one call. Follow `verification-loop`: run the project's real build/type-check/lint/tests after every code step; fix before moving on.
5. **Report** (short): categories used, members used/skipped, checks run + results, open risks.

## Categories (skills/agents/commands)
- `core` — Core: harness basics: standards, learning, compaction, always-on rules (13/0/3)
- `workflow` — Workflow: plan, build, test, review, refactor, ship — the engineering loop (56/18/41)
- `ai-agent` — AI Agent: agent harnesses, loops, evals, prompts, context and token economy (50/8/26)
- `security` — Security: security review, scanning, hardening, compliance, crypto (20/2/2)
- `research` — Research: deep research, papers, literature, replication, remote compute (20/1/0)
- `frontend` — Frontend: UI, design systems, React/Vue/Next, a11y, motion, web quality (36/7/8)
- `backend` — Backend: APIs, databases, infra, deploy, Node/.NET/PHP, Encore/Eino, Rust (48/11/3)
- `python` — Python: Python, Django, FastAPI, PyTorch, ML engineering (12/6/2)
- `golang` — Go: Go patterns, testing, build and review (4/2/3)
- `jvm` — JVM: Java, Kotlin, Spring, Quarkus, Android/Compose (17/4/4)
- `swift` — Swift: Swift, SwiftUI, Apple platforms (5/2/0)
- `cpp` — C++: C++, CUDA kernels, x86/SIMD performance (2/2/3)
- `perl` — Perl: Perl patterns, security, testing (2/0/0)
- `industry` — Industry: supply chain, logistics, energy, healthcare, documents (16/1/0)
- `content` — Content: articles, docs, papers, CVs, investor and business writing (13/0/0)
- `specialized` — Specialized: operator tools, media, desks, homelab, niche domains (40/5/1)
- `ads` — Ads & Marketing: campaigns, ads, social, SEO, brand, content distribution, lead gen (32/2/1)
- `game` — Game & 3D: three.js, R3F, GSAP/3D web, Unreal/Blender, game assets (3/0/0)

## How to call members
- `<ECC>` = 8sync's ECC checkout `~/.cache/8sync/ecc/` (tracks upstream: `8sync harness` + a 6-hourly background refresh), else the newest dir under `~/.claude/plugins/cache/ecc/ecc/`.
- Skills: `skill://<name>` loads any skill: `skill://` refs are 8sync's, plain names ECC's (8sync mirrors ECC into omp). Not found → read `<ECC>/skills/<name>/SKILL.md`.
- Agents: a `task` subagent whose assignment opens with "read the role file `<ECC>/agents/<agent>.md` first"; independent agents/steps → ONE `task` call with several `tasks[]` (parallel).
- Commands: run `/ecc-<cmd>` with that step's arguments; not found → read `<ECC>/commands/<cmd>.md` and follow it.
- A member that does not resolve: skip it, say so.
- A skill in your session's skill list that fits the goal but is missing below (ECC updated since this list) is eligible too.
