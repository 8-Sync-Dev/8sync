# hq-ux-r1: multi-agent coding orchestration UIs (read 2026-10-13)
Columns: claim — URL — confidence. Quotes verbatim from WebFetch extraction (small-model summarizer; treat quotes as high-but-not-perfect).

## Claude Code `claude agents` / Agent view
- S1 https://code.claude.com/docs/en/agent-view (docs, 2026-10-13; "research preview")
 - Screenshot alt text: "Agent view in a terminal. A line at the top counts the sessions awaiting input, working, and completed. Four sessions are grouped under Needs input, Working, and Completed. Each row shows the session's name, its latest status or question, and a time. At the bottom are an input for describing a new task and a row of keyboard hints." — high
 - Grouping: "Agent view groups sessions so the ones that need input are at the top, with `Ready for review` and `Needs input` above `Working` and `Completed`." Ctrl+S regroups by directory. — high
 - States/icons: Working=Animated, Needs input=Yellow ("Claude is waiting on something only you can provide"), Idle=Dimmed, Completed=Green, Failed=Red, Stopped=Grey. PR number colored yellow/green/purple/grey. — high
 - Needs input def: "an answer to a question, a permission decision, or another prompt only you can answer, such as a sandbox prompt" — high
 - Peek: "Press `Space` on a selected row to open the peek panel." "Type a reply in the peek panel and press `Enter` to send it to that session." BUT permission dialog: "replying doesn't answer it. Your message waits in the queue. To answer the dialog, attach with `→`" — high
 - Attach: "Press `Enter` or `→` ... to attach ... The session takes over the terminal as a full interactive Claude Code session. Press `←` on an empty prompt to detach"; "Detaching never stops a background session" — high
 - Dispatch: "Type a prompt in the input at the bottom of agent view and press `Enter` to start a new background session." CLI `claude --bg "..."`. Each session auto-moved into git worktree under `.claude/worktrees/`. — high
 - Supervisor: "a background service that runs your background sessions so they keep working after you close agent view or your terminal." — high
 - Third-party: terminal tab title shows awaiting-input count (search snippet of docs; not re-verified in page) — medium
- Inter-agent: none in agent view itself; see S3/S4.

## Claude Code Desktop
- S2 https://code.claude.com/docs/en/desktop (first 100k chars read)
 - "The sidebar lists your sessions and lets you run several in parallel." "filter sessions by status, project, or environment, and to group sessions by project." — high
 - Split view: "hold Cmd ... and click a session in the sidebar. The session opens in a second pane alongside" — high
 - Attention: only OS notification: "sends an OS notification when a Code session finishes a task and you aren't currently viewing that session." No dedicated "needs attention" state found in docs (last 1.9k chars unread). — medium
 - Terminal: "The integrated terminal lets you run commands alongside your session"; terminal in session working dir (a shell, not agent's raw log). Tasks pane: "shows the background work running inside the current session: subagents, background shell commands, and dynamic workflows." — high
 - Inter-session: "Claude can list your other Code tab sessions, read what each has been doing, and send messages between them." "By default it sees the 20 most recently active sessions" — high

## Claude Code agent teams (experimental)
- S3 https://code.claude.com/docs/en/agent-teams
 - List: "The lead's terminal lists teammates in the agent panel below the prompt input. Up/down select; Enter: open the selected teammate's transcript and message it directly; Escape ..." idle rows collapse as "`2 idle agents`" — high
 - Display: in-process vs split panes (tmux/iTerm2): "Split panes: each teammate gets its own pane. You can see everyone's output at once and click into a pane to interact directly." — high
 - Task board: "Tasks have three states: pending, in progress, and completed." dependencies block claiming; "Self-claim: after finishing a task, a teammate picks up the next unassigned, unblocked task"; file locking; Ctrl+T toggles task list. — high
 - Messaging: Mailbox = "~/.claude/teams/{team-name}/inboxes/{agent-name}.json"; "any teammate can message any other by that name"; "Idle notifications: when a teammate finishes and stops, it automatically notifies the lead and includes its final answer". — high
 - Attention: "Teammate permission prompts appear in the lead session, so approve them there yourself." Troubleshooting: "Teammate permission requests bubble up to the lead, which can create friction." — high
 - Safety: SendMessage msg is labelled as from another Claude session; "A teammate can't approve a permission prompt or supply consent on your behalf". — high
 - Handoff pattern: debate prompt "Have them talk to each other to try to disprove each other's theories". Hooks TeammateIdle/TaskCreated/TaskCompleted exit 2 = quality gates. — high
- S4 https://code.claude.com/docs/en/cross-session-messaging (v2.1.224+)
 - "Claude discovers the target with `ListAgents` and sends with `SendMessage`"; `/list-agents` rows: subagents, teammates, other local sessions incl. background sessions, cloud sessions. — high
 - UI: "Claude Code shows it in the conversation as a dim one-line preview ... `› Message from @api-worker: Schema migration finished (ctrl+o to expand)`" — high
 - "@" typeahead names target session. Idle notice: `notify_when_idle`. Inbound modes accept/hold/refuse; held message opens approval dialog (Approve/Deny; 5 min dialogExpiry). Loop throttle: "A message loop between two sessions therefore stops on its own." — high

## GitHub Copilot coding agent / Agent HQ / mission control
- S5 https://github.blog/news-insights/company-news/welcome-home-agents/ (Oct 2025 Universe)
 - "a single command center to assign, steer, and track the work of multiple agents from anywhere"; "a single view of all your agents running in VS Code, in the Copilot CLI, or on GitHub"; third-party agents from "Anthropic, OpenAI, Google, Cognition, and xAI will be available on GitHub" — high (marketing; no UI details)
- S6 https://github.blog/ai-and-ml/github-copilot/how-to-orchestrate-agents-using-mission-control/
 - "a unified interface for managing GitHub Copilot coding agent tasks"; "Session logs show reasoning, not just actions."; steering options "pause, refine, or restart"; no explicit needs-attention flag, no UI screenshots described. — high
- S7 https://github.blog/changelog/2025-08-19-agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github-com
 - "When you open the panel, you'll see a list of tasks you've delegated to Copilot, with a clear status for each." "To head to the pull request, just click on a task in the list." — high
- Inter-agent collaboration: none documented. Mission control = human assigns to many independent agents. — medium
- NOT fetched: VS Code agent sessions docs (ECONNRESET); gh agent-task CLI changelog (seen in search only: github.blog/changelog/2025-09-25-kick-off-and-track-copilot-coding-agent-sessions-from-the-github-cli).

## Cursor
- S8 https://cursor.com/changelog/2-0 : "Manage agents in our new editor, with a sidebar for your agents and plans." "Run up to eight agents in parallel on a single prompt." "This uses git worktrees or remote machines to prevent file conflicts." — high
- S9 https://cursor.com/docs/background-agent (redirected from docs.cursor.com/en/background-agent; page now cloud agents): "Start and manage agents from cursor.com/agents, on any device." "Take control of the agent's desktop to test the software yourself" / "Release control back to the agent"; "Agents produce screenshots, videos, and logs so you can see exactly what changed."; shared runs read-only unless "a team admin can enable team follow-ups". Slack for "receiving notifications". — high for quotes; page lacks list/status UI detail (not found)
- Inter-agent: none found (parallel best-of-N on one prompt, not communication).

## OpenAI Codex cloud
- S10 https://learn.chatgpt.com/docs/cloud (redirect from developers.openai.com/codex/cloud): "Describe your task and send it. Review the changes and test results, request follow-ups, and commit or open a pull request when ready."; each task "has its own workspace and can keep working while your computer is asleep"; CLI "list recent cloud chats and check their status". Docs page lacks task-list/log/status UI description. — medium (gap)

## Devin
- S11 https://docs.devin.ai/work-with-devin/devin-session-tools.md : session has IDE ("You can watch Devin make edits in real-time."), Browser ("directly view and interact with Devin's browser and desktop environment"), Shell ("All of Devin's terminals, commands, and their outputs are available in VSCode."), Side Chat ("ask questions about a session without interrupting Devin's main work", read-only). — high
- S12 https://docs.devin.ai/work-with-devin/advanced-capabilities.md : parent/child: "The coordinator session scopes the work, monitors progress, resolves conflicts, and compiles results."; parent "is woken automatically, even if it is asleep" when child "finishes or needs input"; parent can "send follow-up instructions or clarifications to running sessions"; "By default it starts child sessions without asking first." (setting Auto-approve child sessions). — high. UI of child sessions list: not documented in fetched page.
- S13 API (search snippet) https://docs.devin.ai/openapi.yaml : v3 session status new/running/suspended/exit + status_detail incl. waiting for user input / approval — medium (snippet only)
- Inter-agent: YES (coordinator -> managed child sessions, orchestrated by parent, not peer-to-peer).

## Conductor (conductor.build)
- S14 https://www.conductor.build/docs : "Each task gets its own workspace, branch, files, terminal, diff, and review path." Links: concepts/workspaces-and-branches, /workflow, /parallel-agents, reference/diff-viewer, /checks, /agent-modes. — high
- S15 https://www.conductor.build/docs/concepts/workflow : "Archive finished workspaces so your sidebar stays focused."; History pane restores workspace + chat; "inspect git status, CI, deployments, comments, and todos before you merge" (Checks tab); inline review comments become composer attachments sent back to the agent; "Use Claude Code, Codex, Cursor, or OpenCode directly in Conductor". — high
- S16 https://www.conductor.build/docs/core/parallel-agents : "Create a new workspace with Command + N". Search snippet: homepage "see at a glance what they're working on". Exact status/needs-attention UI NOT found in docs fetched. — medium
- Inter-agent: none found (isolated workspaces).

## Crystal (stravu)
- S17 https://github.com/stravu/crystal : "Crystal (formerly a multi-session AI code assistant manager) has been deprecated and replaced by Nimbalyst." "Deprecated: February 2026." Described as "Run multiple Codex and Claude Code AI sessions in parallel git worktrees." No UI detail on README. — high (deprecation), UI not found

## Vibe Kanban (BloopAI)
- S18 https://github.com/BloopAI/vibe-kanban : "Vibe Kanban is sunsetting."; "create, prioritise, and assign issues on a kanban board"; "each workspace gives an agent a branch, a terminal, and a dev server"; 10+ agents; diff review: "send feedback directly to the agent without leaving the UI." No status columns/logs text on README. — high (sunsetting), medium (UI)
- Task board = the headline kanban; inter-agent: none found.

## Sculptor (Imbue)
- S19 https://github.com/imbue-ai/sculptor (docs.imbue.com redirects here): "Sculptor is actively under development and should be treated as an experimental research preview."; docs index lists "Chat", "Terminal: the built-in terminal scoped to the workspace", "Agents: running multiple agents and complex tasks", "add one" agent to workspace to "collaborate with another agent on the same project". — medium
- S20 (search snippets only) https://docs.imbue.com/features/pairing-mode : Pairing Mode mirrors agent container into local IDE, syncs both ways; https://docs.imbue.com/features/containers : each Claude runs in its own container — medium (not fetched)
- Inter-agent: README hints multiple agents per workspace; mechanism not verified.

## Terragon
- S21 https://github.com/terragon-labs/terragon-oss : "This repository is an open-source snapshot of Terragon at the time of shutdown." "a remote background agent orchestrator for running Claude Code, Codex, and other coding clis in the cloud." "Task status and agent progress stream to your browser in real-time." Has dashboard screenshot, no text. — high (shutdown), medium (UI)
- S22 https://brsbl.substack.com/p/the-way-we-collaborate-is-about-to (search snippet): "dashboard shows progress and CI status" — low/medium

## Orca (stablyai)
- S23 https://github.com/stablyai/orca : "Know when an agent finishes or needs attention, then mark threads unread to come back later."; "Ghostty-class terminals with WebGL rendering, infinite splits, and scrollback that survives restarts."; "Fan one prompt across five agents, each in its own isolated git worktree — compare the results and merge the winner."; "Monitor and steer your agents from your phone."; "Agents drive Orca too — script every workflow with `orca worktree create`, ..."; "Browse PRs, issues, and project boards in-app — open a worktree from any task". — high
- Inter-agent: none (agents drive Orca via CLI, not each other).

## Which show inter-agent collaboration at all
- YES: Claude Code agent teams (mailbox + shared task list + peer messaging, S3), Claude Code cross-session messaging (S4), Claude Desktop (list/read/message other sessions, S2), Devin managed sessions (parent<->child, S12).
- Not found: Cursor, Copilot Agent HQ, Codex cloud, Conductor, Crystal, Vibe Kanban, Orca, Terragon. Sculptor: unclear.

## Contradictions
- Sculptor: official search snippet says containers; product-page snippet says worktree. Unresolved.
- Cursor doc URL changed from "background agent" to "cloud agents"; older "Background Agents" sidebar-list UI not re-verified.
- Claude Desktop docs have no "agent view"/attention state; agent view is a CLI feature (S1). A third-party site claimed otherwise? Not checked.

## Not found
- Screenshots/UI text for: Conductor status/needs-attention; Codex cloud task list; Cursor agents list statuses; Devin session-list sidebar and child-session display; Terragon task list; Vibe Kanban columns; Sculptor agent list/status; Copilot mission control layout beyond "list ... with a clear status for each".
- Desktop docs last 1,891 chars unread.
