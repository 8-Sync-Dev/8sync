# STATE — auto-harness: 5 auto command levels for ccc (stronger than omp, rules-compliant)

## Goal
Give official Claude Code (ccc) five graded "hands-off" commands — /do, /ship, /ship-auto, /ship-loop, /autopilot — that run work to completion with one Ship checkpoint, each wired to /sec, /rules and /aup-audit, tested for real, and faster/safer than omp's yolo tier. No subscription OAuth outside official Claude Code; API keys only via the owner's env, never chat.

## Checklist
- [x] R&D: omp autonomy mechanics (approval tiers, goal mode, plan-yolo, stop/settle, loops) from the research clone; ralph-loop / autonomous-loop patterns on GitHub; Claude Code /loop, Stop hook, Workflow limits
- [x] Design: level table (trigger, stop condition, checkpoints, safety hooks per level), skill files + any Rust support (loop state file, iteration cap, ship grant)
- [x] Code: 4 new skills (/do, /ship-auto, /ship-loop, /autopilot) + updates to /ship; tests for Rust parts
- [x] Test: CI green (auto-levels 38392159037/38392354465, PR #18 all green)
- [x] UAT: /do (27 s, 1 file, no commit) and /ship-loop (55 s, 1 iter, green + LOOP.md) on levels-repo; /ship-auto, /autopilot not verified (interactive Ship + remote CI needed)
- [x] Review: 2 rounds → MERGEABLE; /sec (gitleaks, cargo audit) + /aup-audit on ship-grant diff; /rules: no permission bypass, Claude Code permissions untouched
- [x] Docs + CHANGELOG + KNOWLEDGE
- [x] Released v0.76.0 (PR #18) after v0.75.0; installed on the owner's machine 2026-10-13

## Evidence
- Review round 1 fixed (caps inclusive, atomic save, corrupt handling, skill wording).
- 2026-10-13: owner pasted an API key in chat; refused to use/store it, asked for rotation. Not recorded here.

## Next
- UAT /ship-auto interactively on a repo with CI; /autopilot dry run.
- Backlog from ZUS Sessions plan (via rd): S2 --offline, S4 atomic registry, S1 --json schema; S3 masker fix in PR.
- HQ nit: subtitle shows the long sid for matched desks (show 8 chars).
