# Q2 evidence: orchestrator-worker / role-based multi-agent for software work
Read 2026-10-15. Format: claim — URL — quote/number — confidence. Quotes via WebFetch summaries (small model), not raw page; re-check exact wording before citing verbatim.

## Sources
S1 https://www.anthropic.com/engineering/multi-agent-research-system (Anthropic, published Jun 13, 2025)
S2 https://www.anthropic.com/engineering/building-effective-agents (Anthropic, published Dec 19, 2024; page notes tooling has since changed)
S3 https://cognition.com/blog/dont-build-multi-agents (Cognition; byline "06.12.25", read as 12 Jun 2025 = inference)
S4 https://arxiv.org/abs/2308.00352 (MetaGPT, v1 1 Aug 2023, v7 1 Nov 2024; numbers from html v7)
S5 https://arxiv.org/abs/2503.13657 (MAST, 17 Mar 2025, v3 26 Oct 2025)
S6 https://arxiv.org/abs/2307.07924 (ChatDev, v1 16 Jul 2023, v5 5 Jun 2024, ACL 2024)
S7 https://arxiv.org/pdf/2505.16975 (SWE-Dev) - only via search snippet, body not readable
S8 X post by Walden Yan 2026-04-22 + FlowHunt summary - secondary only

## Evidence
1. Lead+subagents beat single agent on research — S1 — "outperformed single-agent Claude Opus 4 by 90.2% on our internal research eval" (lead Opus 4, subagents Sonnet 4; research task, not coding) — high
2. Token spend drives the gain — S1 — "token usage by itself explains 80% of the variance"; 3 factors = 95% on BrowseComp — high
3. Cost multiple — S1 — "agents typically use about 4x more tokens than chat"; "multi-agent systems use about 15x more tokens than chats" — high
4. Effort scaling — S1 — "1 agent with 3-10 tool calls" simple fact-finding; "2-4 subagents with 10-15 calls each" comparisons; "more than 10 subagents" complex research — high
5. Over-spawning failure — S1 — early failure: "spawning 50 subagents for simple queries" — high
6. Parallelism — S1 — lead launches "3-5 subagents in parallel"; subagents use "3+ tools in parallel"; "cut research time by up to 90% for complex queries" — high
7. Delegation brief anatomy — S1 — "Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries"; vague briefs caused duplicated searches and gaps — high
8. Poor fit for shared context / coding — S1 — poor fit for "domains that require all agents to share the same context"; "most coding tasks involve fewer truly parallelizable tasks than research" — high
9. Eval approach — S1 — ~20 queries to start; single LLM judge 0.0-1.0 + pass/fail; judge end state; "manual testing remains essential" — high
10. Memory/checkpoint — S1 — lead saves plan to memory because context truncates at 200,000 tokens; resume from failure point; "deterministic safeguards like retry logic and regular checkpoints"; spawn fresh subagents with clean contexts — high
11. Orchestrator-workers fit — S2 — "well-suited for complex tasks where you can't predict the subtasks needed"; example "Coding products that make complex changes to multiple files each time" — high
12. Parallelization — S2 — "effective when the divided subtasks can be parallelized for speed"; voting = "Running the same task multiple times to get diverse outputs" — high
13. Start simple — S2 — "finding the simplest solution possible, and only increasing complexity when needed" / "only when it demonstrably improves outcomes" — high
14. Cognition principles — S3 — P1 "Share context, and share full agent traces, not just individual messages"; P2 "Actions carry implicit decisions, and conflicting decisions carry bad results" — high
15. Cognition failure example — S3 — Flappy Bird clone: one subagent builds Super Mario-style background, other builds mismatched bird; final agent must merge conflicts — high
16. Cognition recommendation — S3 — single-threaded linear agent ("the context is continuous"); for huge tasks, a compression model, "hard to get right" — high
17. MetaGPT SOP/role design — S4 — "encodes Standardized Operating Procedures (SOPs) into prompt sequences"; "assembly line paradigm"; "more coherent solutions than previous chat-based multi-agent systems" — high
18. MetaGPT benchmarks — S4 — "new SoTA with 85.9% and 87.7% in Pass@1" (HumanEval, MBPP); executable feedback +4.2% / +5.4% — high (baselines not in text, Fig 4 image)
19. MetaGPT vs ChatDev SoftwareDev (Table 1) — S4 — executability 3.75 vs 2.25; human revision cost 0.83 vs 2.5; tokens 31,255 vs 19,292; time 541s vs 762s — high (note: MetaGPT uses more tokens)
20. Role ablation (Table 3) — S4 — Engineer only: revisions 10, exec 1.0, $0.915; all 4 roles: revisions 2.5, exec 4.0, $1.385 (+51% cost). PM+Project Manager row (3.5 rev, exec 2.0) vs Architect row (4.0, 2.5) breaks monotonic claim — high. Caveat: authors' own benchmark, small n not checked
21. Failure taxonomy — S5 — ">1,600 annotated traces, 7 MAS frameworks"; "14 unique modes, clustered into 3 categories": system design, inter-agent misalignment, task verification; "performance gains on popular benchmarks are often minimal"; kappa=0.88 — high (abstract); category percentages not read [UNVERIFIED]
22. ChatDev — S6 — specialised agents across design/coding/testing; abstract has no numbers; paper results not read — [UNVERIFIED numbers]
23. SWE-Dev multi-agent error types — S7 via search snippet — multi-agent "reduced incomplete errors" but "more logic or syntax errors" — [UNVERIFIED] PDF unreadable; no numbers
24. SWE-bench leaderboard analysis (arXiv 2506.17208) — search snippet only — cannot show single beats multi on Lite/Verified; one trajectory review: multi-agent = short localized patches, single agents over-edit or miss multi-site fixes — [UNVERIFIED]
25. Cognition 2026 reversal — S8 — Yan X post 2026-04-22 says landscape changed, "a few specific flows" in Devin; FlowHunt says Mar 2026 "Devin can now Manage Devins" (coordinator + isolated VM per managed Devin) — [UNVERIFIED] primary post not opened
26. SWE-bench Verified retired — search snippet — "59.4% of audited problems had flawed tests" (OpenAI) — [UNVERIFIED] primary not opened; read benchmark claims with caution

## Actionable rules (derived; each tied to evidence above, my synthesis not source text)
- Stay single when subtasks share context or edit the same files (1, 8, 14-16). Fan out only for independent, read-heavy or file-disjoint work (6, 8, 12).
- Scale workers to complexity: 1 for simple; 2-4 for comparison-sized; >10 only for broad research (4, 5). Cap at 3-5 concurrent (6).
- Brief template: objective, output format, tools/sources, boundaries (7). Add: files owned, done criteria, what other workers are doing (inference from 5, 7, 15).
- File ownership: one writer per file; conflicting implicit decisions are the failure mode (14, 15). Pass full context/trace or decisions log, not just a summary (14).
- Verification step: task verification and inter-agent misalignment are top failure categories (21); roles with a review/test stage cut human revisions in MetaGPT (19, 20); executable feedback +4-5 points (18). Judge final state, keep manual check (9).
- Budget: expect ~15x tokens (3); gain is largely token-driven (2), so single agent with more budget may match [inference, not tested in sources].
- Memory/retro: persist plan and decisions outside context; checkpoint and resume (10).

## Contradictions
- S1/S2 favour orchestrator-workers; S3 (Jun 2025) says avoid. S1 itself says coding is a poor fit, partly reconciling. S8 suggests Cognition moved toward orchestration by 2026 with isolated workers [UNVERIFIED].
- S4 says roles consistently improve results, but Table 3 PM+Project Manager row is worse than Architect row; authors' benchmark only.
- S1 gain (90.2%) is research tasks and internal eval; no coding multi-agent vs single number found.

## Not found
- Controlled 2025-2026 multi-agent vs single-agent SWE-bench measurement with numbers (SWE-Dev, 2506.17208, BOAD 2512.23631 only seen as titles/snippets).
- ChatDev measured numbers; MAST failure-mode percentages; Scrum-for-agents writeup with measurements; Cognition 2026 primary post.
