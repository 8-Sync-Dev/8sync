# Plan: sprint-delegation (2026-10-15)
Question: HQ shows only the Lead working in each room (R&D/Plan/Fullstack/Reviewer/Tester/Quick/Critic idle).
Why does a Claude Code lead do the work itself instead of delegating, and what scrum-master style orchestration
(sprint plan → parallel assignment → standup → review → retro) measurably raises throughput without wasting tokens?
Key questions:
 Q1 Claude Code primitives for parallel delegation and their limits (docs, current versions).
 Q2 Evidence on orchestrator-worker / role-based (SOP, scrum) multi-agent coding: when it helps, when it hurts, effort-scaling rules.
 Q3 Local measurement: how often our leads delegate today (Agent calls vs own Edit/Write/Bash) across ~/.claude/projects transcripts.
Scale: survey, 3 researchers (one per Q). Prior work to read first: ~/research/ccc-vs-omp/outputs/no-idle-office.md
Output: su-code/research/sprint-delegation.md (+ .provenance.md)

Owner addendum (2026-10-15): "đừng để bị ngồi không ở các role khác — giống daily sprint, trong ngày có nhiều lần
họp mặt all role để review lại backlog, done, bug". → design must include a recurring STANDUP ceremony (several per day):
lead gathers every role (parallel subagents/teammates), each reports done / doing / blocked, reviews backlog + open bugs,
and leaves with an assignment; idle role = a defect the standup must fix.
