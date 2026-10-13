# STATE — auto-harness: 5 auto command levels for ccc (stronger than omp, rules-compliant)

## Goal
Give official Claude Code (ccc) five graded "hands-off" commands — /do, /ship, /ship-auto, /ship-loop, /autopilot — that run work to completion with one Ship checkpoint, each wired to /sec, /rules and /aup-audit, tested for real, and faster/safer than omp's yolo tier. No subscription OAuth outside official Claude Code; API keys only via the owner's env, never chat.

## Checklist
- [ ] R&D: omp autonomy mechanics (approval tiers, goal mode, plan-yolo, stop/settle, loops) from the research clone; ralph-loop / autonomous-loop patterns on GitHub; Claude Code /loop, Stop hook, Workflow limits
- [ ] Design: level table (trigger, stop condition, checkpoints, safety hooks per level), skill files + any Rust support (loop state file, iteration cap, ship grant)
- [ ] Code: 4 new skills (/do, /ship-auto, /ship-loop, /autopilot) + updates to /ship; tests for Rust parts
- [ ] Test: CI green
- [ ] UAT: run each level on a throwaway repo task; record commands + outcomes
- [ ] Review (reviewer MERGEABLE) + /sec + /rules + /aup-audit on the diff
- [ ] Docs + CHANGELOG + KNOWLEDGE
- [ ] Commit; release only after the ship-grant release (v0.75.0) lands

## Evidence
- 2026-10-13: owner pasted an API key in chat; refused to use/store it, asked for rotation. Not recorded here.

## Next
R&D agents running (omp src scan, loop patterns). Meanwhile v0.75.0 (ship-once grant) CI is in flight.
