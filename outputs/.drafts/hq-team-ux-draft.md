# HQ team UX: draft brief (2026-10-14)

Scope: UX for 8sync HQ (`8sync hq ui`), a local web UI over many official Claude Code sessions in tmux. Evidence read 2026-10-13 from official docs and READMEs; numbers in brackets refer to `## Sources`. Claims without a source in the evidence are marked [UNVERIFIED].

## Recommendation

**Information architecture (IA).** Make a dense, sortable **session list the primary surface**, grouped by attention state: Needs you, Working, Done/Ended [1][30]. Keep the office as a **thin glanceable strip/secondary tab**, not the only way to find a session. Rationale: Claude Code's own agent view groups "Needs input" above "Working" and "Completed" [1]; Claude Office's command center uses the same four buckets (Needs-you, Working, Done, Ended) [30]; even Smallville pairs its map with an agent list [28 (secondary summary, low)]. No study comparing spatial vs list dashboards for multi-agent monitoring was found (inference only).

Proposed levels: (1) header: counts of needs-you / working / done + persistent badge; (2) session list/office strip; (3) session detail = Chat phòng + terminal drawer + task/subagent roster; (4) Chat nhóm = cross-session thread; (5) Báo cáo, guide.

**Core flow 1: open a session's terminal.** One click or Enter on any row/desk/card opens the live terminal drawer; Esc closes it; attaching/detaching never stops the session [1]. Show clearly that a typed reply is not the same as answering a permission dialog (agent view queues replies and requires attach for the dialog) [1]. Offer full-screen toggle and keyboard-only access.

**Core flow 2: see agents helping each other in one thread.** One chronological thread (Chat nhóm) with typed items: owner message, A to B handoff card, task card (role, state), final-answer/idle notice, needs-you callout. Evidence for the building blocks: Claude Code shows cross-session messages as a labelled dim one-line preview `› Message from @api-worker: ...` [4]; teammates send idle notices that include the final answer [3]; Linear models human-visible handoff as typed activities (thought, elicitation, action, response, error) with ephemeral thought/action replaced by the next activity [25]; OpenAI tracing records handoffs as their own spans with parent/child nesting [22]. Messages from agents must be labelled as from another session, never as the user [3]. No source showing a swimlane or avatar-thread for agent-to-agent messages was found.

**Core flow 3: act on "needs you".** Needs-you is a persistent, counted state (never a toast only) with the question text inline, a primary action (answer / approve / open terminal), and highest-attention-wins when states are consolidated [32][33]. Define it narrowly, as agent view does: "an answer to a question, a permission decision, or another prompt only you can answer" [1]. Show it where permission prompts originate; in agent teams, teammate prompts bubble up to the lead and "can create friction" [3].

## Evidence by research question

### Q1. How do multi-agent orchestration UIs present sessions, status, needs-you, terminal, chat, board?
- Claude Code agent view: rows show name, latest status or question, time; status by color and animation (Working animated, Needs input yellow, Completed green, Failed red); peek panel on Space; attach on Enter/right arrow; dispatch input at the bottom starts a background session in a worktree [1].
- Claude Desktop: sidebar with status/project filters and grouping; split view; OS notification when a session finishes while unviewed; no dedicated needs-attention state found in the docs read [2].
- Agent teams: agent panel below the prompt; Enter opens a teammate transcript and messages it; idle rows collapse to "2 idle agents"; shared task list with pending / in progress / completed plus dependencies; "Task status can lag" [3].
- Copilot Agent HQ / agents panel: "a single command center to assign, steer, and track the work of multiple agents" [5]; task list "with a clear status for each" [7]; session logs "show reasoning, not just actions" [6]. No needs-attention flag found.
- Cursor 2.0: sidebar for agents and plans; up to eight parallel agents in worktrees or remote machines [8]. Cloud agents: take over the agent's desktop, screenshots/videos/logs, Slack notifications [9].
- Devin: IDE, browser, shell and read-only Side Chat per session [11]; parent session "is woken automatically" when a child finishes or needs input [12].
- Conductor: each task has its own workspace, branch, terminal, diff, review path; archive finished workspaces "so your sidebar stays focused" [13][14].
- Orca: "Know when an agent finishes or needs attention, then mark threads unread"; terminals with scrollback that survives restarts [15].
- Codex cloud: docs page lacks task list/status UI description (gap) [10].

### Q2. What patterns show what an agent is doing, and collaboration?
- Per-step cards with status icons; running and error steps open, completed collapse in Reasoning (auto-open while streaming, close when finished) [16][17][18]. The Tool component opens completed tools by default, which risks a scroll wall (my synthesis).
- Edit summary (files, lines) plus a separate review surface with per-hunk accept/reject, and a "follow" mode [19]; inline checkpoints with Compare/Restore [21].
- Roster with idle-collapse [3]; Linear session states pending/active/error/awaitingInput/complete/stale [25]; Slack task cards and a stop button, with the pitfall that status "stays in processing until it times out after one hour" [26].
- Trace views: Langfuse agent graph merges same-name steps into one node with a counter (aggregated) or unrolls loops (expanded) [23]; LangSmith has threads and trajectories [24].
- Collaboration exists in Claude Code (mailbox, shared task list, peer messaging) [3][4] and Devin (coordinator to child, not peer-to-peer) [12]. Not found for Cursor, Copilot, Codex, Conductor, Orca.

### Q3. Do spatial/pixel offices help? Attention and accessibility?
- Existing pixel tools: one character per Claude Code terminal, poses for writing/reading/running, bubbles for "waiting for input or needs permission" [29]; Claude Office adds a Command Center and decorative extras [30]. Pixel Agents admits status heuristics "often misfire" [29].
- AI Town and Smallville are social simulations, not monitoring tools [27][28].
- NN/g: dashboards are for at-a-glance action; position and length scan well; color should not encode magnitude; circular/space-hungry visuals carry little information [31].
- No controlled Gather.town awareness study found.

## Comparison (only what the evidence supports)

| Product | Session list/status | Needs-you signal | Terminal / live view | Inter-agent collaboration | Source |
|---|---|---|---|---|---|
| Claude Code agent view | Grouped by state, color + animation | Yellow "Needs input", top group | Peek panel, attach | None in view; via messaging | [1][4] |
| Claude Code Desktop | Sidebar, filters, split view | OS notification on finish only | Integrated shell terminal | List/read/message other sessions | [2] |
| Claude Code agent teams | Agent panel, idle collapse | Prompts bubble to lead | Split panes or transcript | Mailbox, task list, peer messages | [3] |
| Copilot Agent HQ | Task list with status | Not found | Session logs | Not found | [5][6][7] |
| Cursor 2.0 / cloud | Agent sidebar | Slack notifications | Remote desktop takeover | Not found (parallel best-of-N) | [8][9] |
| Devin | Not found | Parent woken on needs input | IDE, browser, shell | Coordinator to child | [11][12] |
| Conductor | Workspace sidebar | Not found | Per-workspace terminal | Not found | [13][14] |
| Orca | Threads, unread marks | "finishes or needs attention" | WebGL terminals | Not found | [15] |
| Pixel Agents / Claude Office | One character per terminal | Bubble / Needs-you column | n/a | Subagents as employees [30] | [29][30] |

Crystal (deprecated Feb 2026), Vibe Kanban (sunsetting) and Terragon (shutdown) are not useful as live references [39][40][41].

## Accessibility and low-noise principles
1. Never color-only: pair color with icon and text label; at least 3:1 contrast; more than five or six indicators hurts focus [32].
2. Highest-attention wins when consolidating states [32].
3. Persistent over transient for needs-you: toasts interrupt, vanish, and should be dismissible and non-critical; critical items use a persistent inline element [33][34].
4. Calm tech: smallest possible attention, use the periphery, "should work even when it fails" [35].
5. Motion: auto-moving content longer than 5 s needs pause/stop/hide (WCAG 2.2.2, Level A) [36 (text from search summary, verify verbatim)]; honor `prefers-reduced-motion`, since panning/scaling of large objects can trigger vestibular symptoms [37]. Animate only on state change; static by default.
6. Do not show a wrong state decoratively; label unknown as unknown [29].
7. Collapse idle, archive finished, cap list noise [3][14].
8. Ephemeral thought/action lines replaced by the next activity [25].

## Gap check vs HQ v0.80.0 [38]

| Pattern | HQ status | Suggested next step |
|---|---|---|
| Rooms per session, role seats lit by subagents | done [38] | Verify seats come from real SubagentStart/Stop events, not heuristics [29] |
| Triage list grouped by Needs you / Working / Done | partial (sidebar groups by git folder and branch; "needs you" cards exist) [38] | Add an attention-grouped list with counts in header |
| Terminal drawer, <1 s refresh, dialog keys | done [38] | Document reply-vs-dialog difference [1]; keyboard access test |
| Single thread with handoff and task cards | done (Chat nhóm) [38] | Add typed ephemeral "working" items; filter by session |
| Walker/handoff bubbles with reduced motion | done (static with reduced motion) [38] | Add visible pause toggle (WCAG 2.2.2) [36] |
| Assign-by-role with model routing | done [38] | None from this evidence |
| Persistent needs-you badge/tab title count | not verified in changelog | Check; agent view surfaces counts [1] |
| Status never color-only (icon + label) | not verified | Audit against Carbon rules [32] |
| Idle collapse / archive finished rooms | missing in changelog | Collapse idle rooms; add Archive [3][14] |
| Cost/time reporting | done (Báo cáo; "chưa đo" never estimated) [38] | None |
| Inbox for non-tmux sessions, no spoofing of owner | done [38] | None |
| Diff/edit-summary per session | missing in changelog | Show files/lines changed in room; link to review [19] |
| Mobile/narrow layout | partial (tab bar overflow fixed) [38] | Test list-first layout at phone width |
| Notifications when tab is hidden | not verified | Use OS/title badge, not toast-only [33] |

## Caveats
- Fetches were summarised by a small model; quotes need re-check before publication (r1, r2).
- Many "not found" items reflect docs I could not read, not absence of features (Codex, Devin list UI, Conductor status, Cursor list).
- Agent view and agent teams are research preview/experimental and may change [1][3].
- Pixel Agents upstream attribution unclear (fork read) [29]. Smallville UI from secondary summary [28].
- WCAG pages returned 403; 2.2.2 text from a search summary [36]; 2.3.3 level not source-verified.
- The hybrid recommendation (office strip above dense list) is inference, not a sourced finding.
- Product adoption or usage numbers: none gathered [UNVERIFIED].

## Sources
1. https://code.claude.com/docs/en/agent-view
2. https://code.claude.com/docs/en/desktop
3. https://code.claude.com/docs/en/agent-teams
4. https://code.claude.com/docs/en/cross-session-messaging
5. https://github.blog/news-insights/company-news/welcome-home-agents/
6. https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/
7. https://github.blog/changelog/2025-08-19-agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github-com
8. https://cursor.com/changelog/2-0
9. https://cursor.com/docs/background-agent
10. https://learn.chatgpt.com/docs/cloud
11. https://docs.devin.ai/work-with-devin/devin-session-tools.md
12. https://docs.devin.ai/work-with-devin/advanced-capabilities.md
13. https://www.conductor.build/docs
14. https://www.conductor.build/docs/concepts/workflow
15. https://github.com/stablyai/orca
16. https://elements.ai-sdk.dev/components/task
17. https://elements.ai-sdk.dev/components/tool
18. https://elements.ai-sdk.dev/components/reasoning
19. https://zed.dev/docs/ai/agent-panel
20. https://docs.warp.dev/agents/using-agents
21. https://docs.cline.bot/features/checkpoints
22. https://openai.github.io/openai-agents-python/tracing/
23. https://langfuse.com/docs/observability/features/agent-graphs
24. https://docs.langchain.com/langsmith/observability-concepts
25. https://linear.app/developers/agent-interaction
26. https://docs.slack.dev/ai/ai-apps-best-practices
27. https://github.com/a16z-infra/ai-town
28. https://arxiv.org/abs/2304.03442 (paper); UI via https://github.com/joonspk-research/generative_agents (secondary summary)
29. https://github.com/martinmunozhr/pixel-agents (fork; upstream unconfirmed)
30. https://github.com/paulrobello/claude-office
31. https://www.nngroup.com/articles/dashboards-preattentive/
32. https://carbondesignsystem.com/patterns/status-indicator-pattern/
33. https://carbondesignsystem.com/components/notification/usage/
34. https://m3.material.io/components/snackbar/guidelines
35. https://www.caseorganic.com/post/principles-of-calm-technology
36. https://www.w3.org/WAI/WCAG20/Understanding/pause-stop-hide (403 on fetch)
37. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
38. /home/alexng/tools/su-code-wd/CHANGELOG.md sections 0.79.0, 0.80.0 (local)
39. https://github.com/stravu/crystal
40. https://github.com/BloopAI/vibe-kanban
41. https://github.com/terragon-labs/terragon-oss
