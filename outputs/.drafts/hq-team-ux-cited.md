# HQ team UX: verified brief (2026-10-14)

Scope: UX for 8sync HQ (`8sync hq ui`), a local web UI over many official Claude Code sessions in tmux. Evidence read 2026-10-13 from official docs and READMEs; verifier re-fetched the high-impact sources on 2026-10-14. Numbers in brackets refer to `## Sources`. Claims without a source in the evidence are marked [UNVERIFIED]. The verification table is at the end.

## Recommendation

**Information architecture (IA).** Make a dense, sortable **session list the primary surface**, grouped by attention state: Needs you, Working, Done/Ended [1][30]. Keep the office as a **thin glanceable strip/secondary tab**, not the only way to find a session. Rationale: Claude Code's own agent view groups `Needs input` (and `Ready for review`, for sessions with a PR to review or failing checks) above `Working` and `Completed`, with an optional `Pinned` group above these [1]; Claude Office's command center uses the same four buckets (Needs-you, Working, Done, Ended) [30]; even Smallville pairs its map with an agent list [28 (secondary summary, low)] [UNVERIFIED: secondary summary only, official repo not read]. No study comparing spatial vs list dashboards for multi-agent monitoring was found (inference only).

Proposed levels: (1) header: counts of needs-you / working / done + persistent badge; (2) session list/office strip; (3) session detail = Chat phòng + terminal drawer + task/subagent roster; (4) Chat nhóm = cross-session thread; (5) Báo cáo, guide.

**Core flow 1: open a session's terminal.** One click or Enter on any row/desk/card opens the live terminal drawer; Esc closes it (HQ design proposal; agent view itself attaches with Enter or `→` and detaches with `←`); attaching/detaching never stops the session [1]. Show clearly that a typed reply is not the same as answering a permission dialog (agent view queues replies and requires attach for the dialog) [1]. Offer full-screen toggle and keyboard-only access.

**Core flow 2: see agents helping each other in one thread.** One chronological thread (Chat nhóm) with typed items: owner message, A to B handoff card, task card (role, state), final-answer/idle notice, needs-you callout. Evidence for the building blocks: Claude Code shows cross-session messages as a dim one-line preview carrying the sender's name, `› Message from @api-worker: Schema migration finished (ctrl+o to expand)` [4]; teammates send idle notices that include the final answer [3]; Linear models human-visible handoff as typed activities (thought, elicitation, action, response, error) with ephemeral thought/action replaced by the next activity [25]; OpenAI tracing records handoffs as their own spans with parent/child nesting [22]. Design rule (inference): label messages from agents as from another session, never as the user. Source basis: Claude Code tells the receiving agent that a `SendMessage` message came from another Claude session, not from the user [3][4]; that is a model-side instruction, not a documented UI rule. No source showing a swimlane or avatar-thread for agent-to-agent messages was found.

**Core flow 3: act on "needs you".** Design proposal (inference): needs-you is a persistent, counted state (never a toast only) with the question text inline and a primary action (answer / approve / open terminal). Sources support only parts of this: Carbon says to use the highest-attention color when statuses are consolidated [32], and that toasts are disruptive, should be used sparingly, auto-close after about five seconds when so coded, and should be easy to dismiss, while inline notifications do not dismiss automatically [33]. Define "needs you" narrowly, as agent view does: "an answer to a question, a permission decision, or another prompt only you can answer" (agent view adds examples such as a sandbox prompt or an MCP server's request for input) [1]. Show it where permission prompts originate; in agent teams, "Teammate permission prompts appear in the lead session" and teammate permission requests bubble up to the lead, "which can create friction" [3].

## Evidence by research question

### Q1. How do multi-agent orchestration UIs present sessions, status, needs-you, terminal, chat, board?
- Claude Code agent view: rows show name, latest status or question, time (screenshot alt text); status by color and animation (Working animated, Needs input yellow, Idle dimmed, Completed green, Failed red, Stopped grey); peek panel on Space; attach on Enter/right arrow; dispatch input at the bottom starts a background session, and Claude moves it into an isolated git worktree under `.claude/worktrees/` before editing files. The terminal tab title shows an awaiting-input count (`2 awaiting input · claude agents`) while agent view is open [1].
- Claude Desktop: sidebar with filters (status, project, environment) and grouping by project; split view; OS notification when a session finishes while unviewed; a phone push notification for Dispatch "when it finishes or needs your approval"; no sidebar needs-attention state found in the first ~100k characters read of the docs (last ~25k characters unread) [2].
- Agent teams: agent panel below the prompt; Enter opens a teammate transcript and messages it; when more than three teammates are idle, rows beyond the first three collapse into one row such as "2 idle agents"; shared task list with pending / in progress / completed plus dependencies; "Task status can lag" [3].
- Copilot Agent HQ / agents panel: "a single command center to assign, steer, and track the work of multiple agents" [5]; task list "with a clear status for each" [7]; session logs "show reasoning, not just actions" [6]. No needs-attention flag found.
- Cursor 2.0: sidebar for agents and plans; up to eight parallel agents in worktrees or remote machines [8]. Cloud agents: take over the agent's desktop, screenshots/videos/logs, Slack notifications [9].
- Devin: IDE, browser, shell and read-only Side Chat per session [11]; parent session "is woken automatically" when a child finishes or needs input [12].
- Conductor: each task has its own workspace, branch, terminal, diff, review path [13]; archive finished workspaces "so your sidebar stays focused" [14].
- Orca: "Know when an agent finishes or needs attention, then mark threads unread"; terminals with scrollback that survives restarts [15].
- Codex cloud: docs page lacks task list/status UI description (gap) [10].

### Q2. What patterns show what an agent is doing, and collaboration?
- Per-step cards with status icons: the Task component has pending / in-progress / completed / error icons [16]; the Tool component has states from input-streaming to output-error, and completed and error outputs open by default [17]; Reasoning auto-opens while streaming and closes when finished [18]. Opening completed tools by default risks a scroll wall (my synthesis).
- Edit summary (files, lines) plus a separate review surface with per-hunk accept/reject, and a "follow" mode [19]; inline checkpoints with Compare/Restore [21].
- Roster with idle-collapse [3]; Linear session states pending/active/error/awaitingInput/complete/stale [25]; Slack task cards and a stop button, with the pitfall that status "stays in processing until it times out after one hour" [26].
- Trace views: Langfuse agent graph merges same-name steps into one node with a counter (aggregated) or unrolls loops (expanded) [23]; LangSmith has threads and trajectories [24].
- Collaboration exists in Claude Code (mailbox, shared task list, peer messaging) [3][4] and Devin (coordinator to child, not peer-to-peer) [12]. Not found for Cursor, Copilot, Codex, Conductor, Orca.

### Q3. Do spatial/pixel offices help? Attention and accessibility?
- Existing pixel tools: one character per Claude Code terminal, poses for writing/reading/running, bubbles for "waiting for input or needs permission" [29]; Claude Office adds a Command Center (shown from the header when 2 or more sessions are active) and decorative extras [30]. Pixel Agents admits its status detection is heuristic and "often misfires" [29].
- AI Town and Smallville are social simulations, not monitoring tools [27][28].
- NN/g: dashboards are for at-a-glance action; position and length scan well; color should not encode magnitude; circular visualizations require a lot of space to communicate little information [31].
- No controlled Gather.town awareness study found.

## Comparison (only what the evidence supports)

| Product | Session list/status | Needs-you signal | Terminal / live view | Inter-agent collaboration | Source |
|---|---|---|---|---|---|
| Claude Code agent view | Grouped by state, color + animation | Yellow "Needs input", top group; tab title count | Peek panel, attach | None in view; via messaging | [1][4] |
| Claude Code Desktop | Sidebar, filters, split view | OS notification on finish; phone push for Dispatch on finish or approval; no sidebar needs-attention state found in text read | Integrated shell terminal | List/read/message other sessions | [2] |
| Claude Code agent teams | Agent panel, idle collapse | Prompts bubble to lead | Split panes or transcript | Mailbox, task list, peer messages | [3] |
| Copilot Agent HQ | Task list with status | Not found | Session logs | Not found | [5][6][7] |
| Cursor 2.0 / cloud | Agent sidebar | Slack notifications | Remote desktop takeover | Not found (parallel best-of-N) | [8][9] |
| Devin | Not found | Parent woken on needs input | IDE, browser, shell | Coordinator to child | [11][12] |
| Conductor | Workspace sidebar | Not found | Per-workspace terminal | Not found | [13][14] |
| Orca | Threads, unread marks | "finishes or needs attention" | WebGL terminals | Not found | [15] |
| Pixel Agents / Claude Office | One character per terminal | Bubble / Needs-you column | n/a | Subagents as employees [30] | [29][30] |

Crystal (deprecated Feb 2026), Vibe Kanban (sunsetting) and Terragon (shutdown) are not useful as live references [39][40][41].

## Accessibility and low-noise principles
1. Never color-only: pair color with icon and text label (Carbon: "Relying solely on color to convey status is insufficient"; "include both the icon and a label"); at least 3:1 contrast; having "more than five or six indicators can overwhelm users", with no strict limit [32].
2. Highest-attention wins when consolidating states [32].
3. Persistent over transient for needs-you: Carbon calls notifications disruptive and to be used sparingly, toasts can auto-close after about five seconds and should be easily dismissed, inline notifications do not dismiss automatically [33]. "Do not use snackbars for critical information" is attributed to Material [34] [UNVERIFIED: the Material page returned no body text on 2026-10-14; earlier evidence is a small-model summary].
4. Calm tech: smallest possible attention, use the periphery, "should work even when it fails" [35].
5. Motion: WCAG 2.2.2 (Level A) requires a pause/stop/hide mechanism for moving, blinking or scrolling information that starts automatically, lasts more than five seconds and is presented in parallel with other content, unless essential; auto-updating information needs pause/stop/hide or frequency control [36]. Honor `prefers-reduced-motion`: "Animations such as scaling or panning large objects can be vestibular motion triggers" [37]. Animate only on state change; static by default.
6. Do not show a wrong state decoratively; label unknown as unknown [29].
7. Collapse idle, archive finished, cap list noise [3][14].
8. Ephemeral thought/action lines replaced by the next activity [25].

## Gap check vs HQ v0.80.0 [38][42]

Status column re-checked by the verifier against CHANGELOG.md (0.79.0, 0.80.0) [38] and code in `apps/hq-ui` [42]; paths below are relative to `apps/hq-ui`.

| Pattern | HQ status | Suggested next step |
|---|---|---|
| Rooms per session, role seats lit by subagents | done [38]. Seats come from SubagentStart/Stop hook events: `lib/server/ingest.ts:99-106`, `lib/office.ts:52-63` (active = no `ended_at`), `lib/server/office.ts:1-4` [42]. The lead seat mirrors session busy state (`lib/office.ts:55`) | Heuristic risk [29] does not apply to specialist seats; no action |
| Triage list grouped by Needs you / Working / Done | partial (confirmed). Office groups by project and branch (`components/hq/office-view.tsx:262`); nav groups by git folder/branch and only sorts group names (`components/hq/nav.tsx:217-229`); no status grouping or sort found in `components/hq`. Needs-you count only in header when >0 (`components/hq/hq-app.tsx:177-181`) [42] | Add an attention-grouped list with counts in header |
| Terminal drawer, <1 s refresh, dialog keys | done [38] (refresh rate and dialog keys from changelog only; not measured). Full-screen toggle with `aria-pressed` at `components/hq/terminal-drawer.tsx:85` [42] | Document reply-vs-dialog difference [1]; keyboard access test (not verified) |
| Single thread with handoff and task cards | done (Chat nhóm) [38]. Item types in `components/hq/team-thread.tsx`: owner/reply (:35-36), handoff (:52), task (:69-70), needs_you with `role="alert"` when open and an "Mở terminal" action (:84-96) [42] | Add typed ephemeral "working" items [25]; filter by session |
| Walker/handoff bubbles with reduced motion | done [38]. Walker is skipped under `prefers-reduced-motion` (`components/hq/office-view.tsx:47`), CSS uses `motion-safe` (:64) and a global reduced-motion rule (`app/globals.css:180-187`) [42]. The walk runs once for 1.6 s (`office-view.tsx:50-52,64`), below the 5 s threshold of WCAG 2.2.2 [36] | The earlier "add visible pause toggle" is not required by [36] for the walker. The only unbounded animation found is the reconnecting dot (`components/hq/nav.tsx:245`, `animate-pulse`), covered by the global reduced-motion rule; whether 2.2.2 applies to it is not verified |
| Assign-by-role with model routing | done [38] | None from this evidence |
| Persistent needs-you badge/tab title count | partial (code-confirmed). Header "Needs you" count (`hq-app.tsx:177-181`), hidden below `sm` (`hq-app.tsx:172`); dot with `aria-label` on the Sessions tab (`hq-app.tsx:196`). No `document.title` or favicon update found (grep over `app`, `components`, `hooks`, `lib`) [42] | Add title count like agent view's `2 awaiting input · claude agents` [1]; show count on phone width |
| Status never color-only (icon + label) | partial (code-confirmed). Text labels present in office rooms (`office-view.tsx:30-33,146`), sessions table (`sessions-view.tsx:93-95`), `WaitingBadge` (`bits.tsx:133-147`). `StatusDot` is an `aria-hidden` color dot (`bits.tsx:25-35`) and the nav row shows text only for waiting / needs_input (`nav.tsx:206-211`); running, idle and ended rows rely on dot color plus a `title` tooltip [42] | Add icon or text for running/idle/ended in nav [32] |
| Idle collapse / archive finished rooms | partial (changelog said missing; code shows part). Nav collapses ended sessions and sessions idle over one day under "Older (n)" (`nav.tsx:166-182`, `lib/labels.ts:20-29`); needs-you and running never collapse. No idle collapse in office rooms and no explicit Archive action found [42] | Collapse idle rooms in the office; add Archive [3][14] |
| Cost/time reporting | done (Báo cáo; "chưa đo" never estimated) [38]; fallback at `components/hq/report-view.tsx:97` [42] | None |
| Inbox for non-tmux sessions, no spoofing of owner | done [38] | None |
| Diff/edit-summary per session | partial (changelog said missing; code shows part). Lines +/− per room (`office-view.tsx:199`) and in Báo cáo (`report-view.tsx:97`); no file list or review link found [42] | Show files changed in room; link to review [19] |
| Mobile/narrow layout | partial. Tab bar overflow fixed [38] (`hq-app.tsx:185` `overflow-x-auto`); nav becomes a sheet below `md` (`hq-app.tsx:142-148`); header counts hidden below `sm` (`hq-app.tsx:172`) [42] | Test list-first layout at phone width; show needs-you count there |
| Notifications when tab is hidden | missing (code-confirmed). No `Notification` API or title/favicon update found; office polling skips fetches while the tab is hidden (`components/hq/use-office.ts:20`) [42] | Use OS/title badge, not toast-only [33] |

## Caveats
- Fetches were summarised by a small model; the high-impact quotes (agent view, agent teams, cross-session messaging, Carbon, WCAG 2.2.2, MDN) were re-fetched on 2026-10-14 and match as worded above. Other quotes rely on the evidence notes (r1, r2, r3) and were not re-fetched.
- Many "not found" items reflect docs I could not read, not absence of features (Codex, Devin list UI, Conductor status, Cursor list; Claude Desktop docs last ~25k characters).
- Agent view is in research preview ("The interface and keyboard shortcuts may change") [1]; agent teams are experimental and disabled by default [3].
- Pixel Agents upstream attribution unclear (fork read) [29]. Smallville UI from secondary summary [28].
- WCAG 2.2.2 text is now taken from the W3C WCAG 2.2 Understanding page (fetched OK); the earlier WCAG 2.0 URL returned 403. WCAG 2.3.3 level was not source-verified and is not used in the body [UNVERIFIED].
- The hybrid recommendation (office strip above dense list) is inference, not a sourced finding.
- Product adoption or usage numbers: none gathered [UNVERIFIED].
- Source [20] (Warp) is kept for numbering but is not cited in the body.

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
20. https://docs.warp.dev/agents/using-agents (not cited in body)
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
34. https://m3.material.io/components/snackbar/guidelines (page text not retrievable 2026-10-14; claim UNVERIFIED)
35. https://www.caseorganic.com/post/principles-of-calm-technology
36. https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html (replaces the WCAG 2.0 URL that returned 403; fetched OK)
37. https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
38. /home/alexng/tools/su-code-wd/CHANGELOG.md sections 0.79.0, 0.80.0 (local)
39. https://github.com/stravu/crystal
40. https://github.com/BloopAI/vibe-kanban
41. https://github.com/terragon-labs/terragon-oss
42. /home/alexng/tools/su-code-wd/apps/hq-ui (local code, read 2026-10-14; paths in the gap table are relative to it)

## Verification table (verifier, 2026-10-14)

Method: "fetched" = source re-fetched on 2026-10-14 with a narrow question; "evidence" = matched against evidence notes r1/r2/r3 only (not re-fetched); "code" = read at file:line.

| claim | source | result |
|---|---|---|
| Agent view groups Needs input above Working and Completed | [1] fetched | FIXED (added `Ready for review`, `Pinned`; group names do not map 1:1 to states) |
| Needs-you definition quote "an answer to a question, a permission decision, or another prompt only you can answer" | [1] fetched | OK (exact substring; examples added) |
| Rows show name, latest status/question, time | [1] alt text (r1) | OK (alt text only; body text not found) |
| State colors: Working animated, Needs input yellow, Completed green, Failed red | [1] fetched | OK (Idle dimmed, Stopped grey added) |
| Peek on Space; attach Enter/right arrow | [1] r1 evidence | OK (evidence) |
| Typed reply queues; attach to answer the dialog; detaching never stops session | [1] fetched | OK |
| Dispatch input starts background session in a worktree | [1] fetched | FIXED (Claude moves the session into a worktree before editing files) |
| Tab title awaiting-input count; header counts (gap row) | [1] fetched | OK (tab title in prose; header line only in alt text) |
| Agent view is research preview | [1] fetched | OK |
| Agent teams experimental; agent panel; Enter opens transcript | [3] fetched | OK |
| Idle rows collapse to "2 idle agents" | [3] fetched | FIXED (only when more than three idle; rows beyond first three) |
| Task states pending/in progress/completed + dependencies; "Task status can lag" | [3] fetched | OK |
| Teammate prompts bubble to lead, "can create friction" | [3] fetched | OK |
| Idle notice includes final answer | [3] fetched | OK |
| "Messages from agents must be labelled as from another session, never as the user" | [3][4] fetched | FIXED (docs: Claude Code tells the receiving agent; not a UI rule; reworded as design rule) |
| Cross-session message shown as dim one-line preview `› Message from @api-worker: ...` | [4] fetched | OK |
| Desktop: sidebar filters/grouping, split view, integrated terminal, list/read/message sessions | [2] fetched | OK |
| Desktop: OS notification on finish only; no needs-attention state | [2] fetched | FIXED (Dispatch phone push on "finishes or needs your approval"; last ~25k chars unread) |
| Claude Office four buckets Needs-you/Working/Done/Ended | [30] fetched | OK (Command Center appears with 2+ active sessions; "Ended" not defined in README) |
| Pixel Agents: one agent one character; bubble waiting for input/permission; heuristics "often misfires" | [29] fetched | OK (README says status detection is "based on heuristics ... and often misfires") |
| NN/g at-a-glance; length/position; color not for magnitude; circular visualizations | [31] fetched | OK |
| Smallville pairs map with agent list | [28] r3 (secondary) | UNVERIFIED |
| AI Town / Smallville are social simulations | [27][28] r3 evidence | OK (evidence) |
| Core flow 3: persistent counted needs-you with inline question and primary action, cited to Carbon | [32][33] fetched | FIXED (reworded as inference; Carbon supports highest-attention and toast guidance only) |
| Principle 1: never color-only, icon + label, 3:1, five or six indicators | [32] fetched | FIXED (quotes: "can overwhelm users"; no strict limit) |
| Principle 2: highest-attention wins | [32] fetched | OK |
| Principle 3: toasts interrupt, vanish, dismissible; critical uses persistent inline | [33] fetched | FIXED (Carbon: disruptive, ~5 s auto-close, easy dismiss, inline does not auto-dismiss; "critical" rule not on Carbon page) |
| Material: do not use snackbars for critical information | [34] fetch | UNVERIFIED (page returned title only) |
| Calm tech principles incl. "should work even when it fails" | [35] r3 evidence | OK (evidence) |
| WCAG 2.2.2 Level A, >5 s, pause/stop/hide | [36] fetched (WCAG 2.2 URL) | FIXED (source URL swapped from 403 page; wording matched to criterion text) |
| prefers-reduced-motion; vestibular triggers sentence | [37] fetched | OK (verbatim) |
| WCAG 2.3.3 level | none | UNVERIFIED (not in body; caveat only) |
| Copilot command center / logs / task list quotes | [5][6][7] r1 evidence | OK (evidence) |
| Cursor sidebar, eight agents, cloud agents, Slack | [8][9] r1 evidence | OK (evidence) |
| Codex cloud lacks list UI | [10] r1 evidence | OK (evidence) |
| Devin session tools; parent woken | [11][12] r1 evidence | OK (evidence) |
| Conductor workspace/terminal/diff; archive finished workspaces | [13][14] r1 evidence | OK (evidence) |
| Orca "finishes or needs attention"; scrollback survives restarts | [15] r1 evidence | OK (evidence) |
| Task/Tool/Reasoning component behaviour | [16][17][18] r2 evidence | FIXED (original sentence said running/error open and completed collapse in Reasoning; evidence: Tool opens completed and error by default, Reasoning auto-opens while streaming) |
| Zed edit summary/review/follow; Cline checkpoints | [19][21] r2 evidence | OK (evidence) |
| OpenAI handoff spans with parent/child | [22] r2 evidence | OK (evidence) |
| Linear activities and states; ephemeral replaced | [25] r2 evidence | OK (evidence) |
| Slack one-hour processing pitfall | [26] r2 evidence | OK (evidence) |
| Langfuse aggregated/expanded; LangSmith threads/trajectories | [23][24] r2 evidence | OK (evidence) |
| Crystal deprecated Feb 2026; Vibe Kanban sunsetting; Terragon shutdown | [39][40][41] r1 evidence | OK (evidence) |
| Gap: rooms and role seats from SubagentStart/Stop | [38], `lib/server/ingest.ts:99-106`, `lib/office.ts:52-63` | OK (done; code-confirmed) |
| Gap: triage list partial | [38], `office-view.tsx:262`, `nav.tsx:217-229`, `hq-app.tsx:177-181` | OK (partial; confirmed) |
| Gap: terminal drawer <1 s refresh, dialog keys | [38] (0.79.0) | OK (changelog only; speed not measured) |
| Gap: Chat nhóm handoff/task/needs-you items | [38], `team-thread.tsx:35-96` | OK (done; code-confirmed) |
| Gap: handoff walker with reduced motion; add pause toggle | [38], `office-view.tsx:47-64`, `globals.css:180-187`, [36] | FIXED (static under reduced motion confirmed; walk is 1.6 s so pause toggle not required) |
| Gap: role routing | [38] (0.79.0) | OK |
| Gap: persistent needs-you badge/tab title | `hq-app.tsx:172-196`; no `document.title` match | FIXED (not verified -> partial) |
| Gap: status never color-only | `office-view.tsx:30-33,146`, `bits.tsx:25-35,133-147`, `nav.tsx:206-211` | FIXED (not verified -> partial) |
| Gap: idle collapse / archive | `nav.tsx:166-182`, `lib/labels.ts:20-29` | FIXED (missing -> partial) |
| Gap: cost/time reporting | [38] (0.80.0), `report-view.tsx:97` | OK |
| Gap: inbox for non-tmux sessions, no owner spoofing | [38] (0.80.0 Added and Security) | OK |
| Gap: diff/edit summary per session | `office-view.tsx:199`, `report-view.tsx:97` | FIXED (missing -> partial) |
| Gap: mobile/narrow layout | [38] (0.80.0 Fixed), `hq-app.tsx:142-185` | OK (partial; detail added) |
| Gap: notifications when tab hidden | no `Notification`/title code; `use-office.ts:20` | FIXED (not verified -> missing) |
