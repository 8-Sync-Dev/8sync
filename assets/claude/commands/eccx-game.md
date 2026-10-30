---
description: "Run a full Game & 3D plan for a goal using every relevant ECC + 8sync skill in this category"
argument-hint: "<goal> [--dry-run]"
disable-model-invocation: true
---

# /eccx-game — Game & 3D

Goal: `$ARGUMENTS` (`--dry-run` = stop after the plan).
Scope: three.js, R3F, GSAP/3D web, Unreal/Blender, game assets.

1. **Select.** From the lists below pick EVERY member that applies to the goal — default to inclusion. List picks with a one-line why; name notable skips.
2. **Load on demand.** Read a picked skill only just before the step that uses it. Never preload all.
3. **Plan.** Numbered steps, each mapped to its skills/agents/commands and its check. `--dry-run`: print the plan and stop.
4. **Execute** step by step with `ecc:verification-loop` discipline: after each code step run the project's real build/type-check/lint/tests as applicable; fix before moving on; no step is done without its check output.
5. **Report** (short): what changed, checks + results, members skipped, open risks.

## How to call members
- Skills: Skill tool — `ecc:<name>` = ECC plugin, plain name = 8sync skill (`~/.claude/skills/`).
- Agents: Task subagent with `subagent_type: "ecc:<agent>"`.
- Commands: run `/ecc:<cmd>` with that step's arguments.
- Needs the ECC plugin (`ecc@ecc`, enabled by `8sync ccc kit`). A member that does not resolve: skip it, say so.

## Skills
- `ecc:blender-motion-state-inspection` — Rigs, poses, animation retargeting, ground contact, facing direction, or model-vs-motion alignment where
- `image-gen` — Generate AI images, icons, logos, diagrams, illustrations, and mockups via gpt-image-2 using
- `ecc:motion-advanced` — Advanced motion patterns for React / Next.js
