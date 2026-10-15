# PLAN: sprint-standup (2026-10-15)

Goal (owner): no role sits idle — scrum-master cadence (sprint plan → parallel roles → standups several
times a day reviewing backlog / done / bugs → review → retro) built into /ship, /ship-auto, /ship-loop,
/autopilot and covering every kit skill + agent; every agent in a room lights up; rooms (sessions) know
each other's name + target and talk continuously without file conflicts.

Evidence: su-code/research/sprint-delegation.md (Q1 primitives, Q2 orchestration, Q3 local: 237 spawns vs
4670 lead calls = 0.051; longest lead run 73 strict).

Design
1. `8sync ccc standup <slug> [init|set|--json]` — board `su-code/ship/<slug>/SPRINT.md` (7 HQ roles), report
   done/doing/blocked/idle, exit 1 when a role is idle; shows other rooms' goal + files and warns on file
   overlap; appends `STANDUP.md`.
2. `8sync ccc . goal <text> [--session n] [--files a,b]` — session target in the registry; shown by
   `ccc . ls`, the SessionStart "Phòng khác đang làm" block and `standup`.
3. Kit skill `/sprint` (scrum master): roster maps every kit agent + skill to a role; ceremonies with exact
   commands; effort scaling (Anthropic: coding is less parallel; cheap assignments, ≤4 concurrent, Sonnet
   /quick-task for small work). /ship, /ship-auto, /ship-loop, /autopilot call it at phase boundaries.
4. Kit: KIT_FILES + CORE_SKILLS include sprint; CLAUDE.md kit block mentions it.

Criteria (one command each, exit 0 = pass)
- C1 standup + goal unit tests: `nice -n 19 ionice -c3 cargo test -p su-code -j2 -- standup urgent room`
- C2 kit tests: `nice -n 19 ionice -c3 cargo test -p su-code -j2 -- kit`
- C3 skill coverage: `bash scripts/uat/sprint-skills.sh`
- C4 UAT standup: `bash scripts/uat/sprint-standup.sh target/debug/8sync`
- C5 UAT goal: `bash scripts/uat/session-goal.sh target/debug/8sync`
- C6 CI 3 OS on the PR branch: `gh pr checks <pr> --watch`

Risks: token cost of always-busy roles (mitigate: cheap assignments, rest needs a reason, cap 4);
CLAUDE_CODE_SESSION_ID unverified on Win/macOS (--session fallback).
