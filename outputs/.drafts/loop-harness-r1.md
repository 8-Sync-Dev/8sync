# loop-harness r1 — official Claude Code docs, read 2026-10-16

Method: WebFetch of code.claude.com pages (summarised by a small model, then quotes checked against the returned text). Docs show no single version stamp; the latest version cited inside the pages is v2.1.299 (scheduled-tasks) / v2.1.296 (agent-teams). "Newest version" = live docs on the read date.

Sources
- S1 https://code.claude.com/docs/en/scheduled-tasks
- S2 https://code.claude.com/docs/en/agent-view (research preview; fetched text truncated at char 100000 of 137050, so version history tail unread)
- S3 https://code.claude.com/docs/en/goal
- S4 https://code.claude.com/docs/en/settings-reference (index row only; page 425k chars, only first 300k read)
- S5 https://code.claude.com/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset
- S6 https://code.claude.com/docs/en/desktop-scheduled-tasks
- S7 https://code.claude.com/docs/en/routines (research preview)
- S8 https://code.claude.com/docs/en/agent-teams
- S9 https://code.claude.com/docs/en/settings (no autoContinueAtUsageLimit hit; the page redirects to settings-reference for keys)

## 1. /loop (S1)
| # | Claim | Source | Date | Conf |
|---|---|---|---|---|
| 1.1 | "Tasks are session-scoped. When you resume with `--resume` or `--continue`, Claude Code restores tasks that haven't expired" | S1 intro | 2026-10-16 | high |
| 1.2 | Fixed: "`/loop 5m check the deploy`" runs on a fixed schedule; units s/m/h/d; "Seconds are rounded up to the nearest minute"; odd intervals (7m, 90m) "rounded to the nearest interval that does [map to a clean cron step]" | S1 | same | high |
| 1.3 | Self-paced (prompt only): "After each iteration it picks a delay between one minute and one hour"; works on every provider; Bedrock/Vertex/Foundry or flag-fetching off need v2.1.248+ | S1 | same | high |
| 1.4 | Bare `/loop` / interval-only: "The built-in maintenance prompt runs, or your `loop.md` if one exists". Maintenance prompt: continue unfinished work, tend the branch PR (review comments, failed CI, conflicts), cleanup passes; "irreversible actions such as pushing or deleting only proceed when they continue something the transcript already authorized" | S1 | same | high |
| 1.5 | loop.md paths: `.claude/loop.md` "Project-level. Takes precedence when both files exist."; `~/.claude/loop.md` "User-level. Applies in any project that does not define its own." Ignored "whenever you supply a prompt on the command line". "Edits to `loop.md` take effect on the next iteration"; "content beyond 25,000 bytes is truncated" | S1 | same | high |
| 1.6 | "Recurring tasks automatically expire 7 days after creation. The task fires one final time, then deletes itself." Applies to self-paced loop too | S1 | same | high |
| 1.7 | "A session can hold up to 50 scheduled tasks at once." Tools: CronCreate / CronList / CronDelete | S1 | same | high |
| 1.8 | Busy behaviour: "A scheduled prompt fires between your turns, not while Claude is mid-response. If Claude is busy when a task comes due, the prompt waits until the current turn ends." Scheduler checks every second, low priority. "No catch-up for missed fires ... it fires once when Claude becomes idle, not once per missed interval." | S1 | same | high |
| 1.9 | Stop: `Esc` clears pending wakeup of self-paced loop; Claude can call `ScheduleWakeup` with `stop: true`; "If an iteration ends without either rescheduling or stopping, Claude Code schedules one fallback wakeup about 20 minutes later and ends the loop when that iteration doesn't reschedule either." | S1 | same | high |
| 1.10 | Restore: "restores the tasks scheduled with `CronCreate`, except recurring tasks that have expired and one-shot tasks whose scheduled time has passed. A self-paced `/loop` isn't restored, so run `/loop` again to restart it. Background Bash and monitor tasks are never restored on resume." | S1 Limitations | same | high |
| 1.11 | "Tasks only fire while Claude Code is running and idle. Closing the terminal or letting the session exit stops them firing. Backgrounding the session carries `/loop` tasks over to a background session, which keeps running without a terminal." | S1 Limitations | same | high |
| 1.12 | Jitter: `*/5 * * * *` (what `/loop 5m` creates) fires 4m45s after previous; hourly or rarer "0 to 30 minutes late"; one-shot at :00/:30 up to 90 s early. Next-run times in CronList need v2.1.299+ | S1 | same | high |
| 1.13 | `CLAUDE_CODE_DISABLE_CRON=1` disables scheduler, cron tools and `/loop` | S1 | same | high |
| 1.14 | With flag-fetching off, a task kept across sessions is stored in project `.claude/scheduled_tasks.json`; runs only in the folder where created | S1 Limitations | same | medium (wording dense) |
| 1.15 | Scheduled fire only runs skills Claude may invoke itself; built-in commands (`/permissions`, `/model`, `/clear`), `disable-model-invocation: true` skills, MCP prompts "reach Claude as plain text instead of executing" | S1 | same | high |
| 1.16 | Monitor tool: "may use it directly when you ask for a dynamic `/loop` schedule" (no polling) | S1 | same | high |

Note: the self-paced loop is NOT restored on `--resume` (1.10) while the task table says "Restored on `--resume`, with exceptions". Not a contradiction, the exception is stated.

## 2. Background session / agent view (S2)
| # | Claim | Source | Conf |
|---|---|---|---|
| 2.1 | Shell: "Pass `--bg` or its long form `--background` to start a session that goes straight to the background": `claude --bg "..."` | S2 | high |
| 2.2 | In session: "Run `/background` or its alias `/bg` to move the current conversation into a background session." Also "press `←` on an empty prompt to background it and open agent view in one step." In a fresh empty session `/bg` asks for a message first, `←` works right away | S2 | high |
| 2.3 | Detach: "Press `←` on an empty prompt, or run `/exit`, to detach and return to agent view." `/fork` copies conversation into new background session (v2.1.212+) | S2 | high |
| 2.4 | "Background sessions don't need any terminal open to keep working. A separate supervisor process runs them" ; "If you detach while a `/loop` is waiting for its next iteration, the loop keeps running and that iteration starts on schedule without you." Pending session-scoped scheduled task (a `/loop` wakeup) counts as working, so process stays alive | S2 | high |
| 2.5 | Idle stop: "Finished or waiting for your next message, and unattached for about an hour: the supervisor stops the process to free resources." "Pin a session with `Ctrl+T` to keep its process running." | S2 | high |
| 2.6 | Crash: supervisor restarts the process. Auto-update: supervisor restarts itself, moves idle sessions over. `claude daemon stop --any --keep-workers` keeps sessions; without `--keep-workers` it ends background sessions | S2 | high |
| 2.7 | Limits: "Sessions are local ... preserved across sleep but stop if the machine shuts down." "Rate limits apply: ... ten agents in parallel uses quota roughly ten times as fast". Claude-created worktrees are deleted with the session in agent view | S2 | high |
| 2.8 | Disable: setting `disableAgentView: true` or env `CLAUDE_CODE_DISABLE_AGENT_VIEW`. Page is "research preview". Opening agent view: `claude agents` (if it lists subagents instead, run `claude update`) | S2 | high |
| 2.9 | Version gates listed: `/resume` picker v2.1.212, `--restricted` v2.1.248, `n:` filter v2.1.287, session name in `claude attach`/`claude logs` v2.1.290. Minimum version for `--bg` / `/bg` itself: not found in docs (fetched part) | S2 | medium |

## 3. /goal (S3)
| # | Claim | Source | Conf |
|---|---|---|---|
| 3.1 | "After each turn, a model checks whether the condition holds. If the model judges it not yet met, Claude starts another turn instead of returning control to you." Setting a goal starts a turn immediately | S3 | high |
| 3.2 | Clears on: condition met, judged impossible, or "an error you have to fix" (auth failure when Claude Code manages credentials, exhausted credit balance, context overflow auto-compaction couldn't clear, model not available) | S3 | high |
| 3.3 | One goal per session; new replaces old; condition up to 4,000 chars; bound with "`or stop after 20 turns`" clause (no built-in turn cap) | S3 | high |
| 3.4 | Evaluator = session-scoped prompt-based Stop hook on the small fast model; "doesn't run commands or read files independently". If no tool use "for several turns in a row" Claude Code stops the loop and returns control with goal still set | S3 | high |
| 3.5 | Does not change permission mode: "To let goal turns run unattended, run `/goal` in auto mode. In Manual mode, Claude still asks before tool calls" | S3 | high |
| 3.6 | Resume: goal restored on `--continue`, `--resume` (all routes since v2.1.239); "carries the condition over but resets the turn count, timer, and token-spend baseline" | S3 | high |
| 3.7 | Usage limit: after a claude.ai usage limit "Goal paused" notice; "If the session is waiting to continue automatically when a usage limit resets, Claude resumes work toward the goal then." Other transient errors: 3 automatic retries then pause (v2.1.269+) | S3 | high |
| 3.8 | Background work defers evaluation; check-in after 30 min (v2.1.234+), then 1h, 2h; max 3 idle check-ins between your prompts (v2.1.246+, idle check-ins v2.1.236+). `CLAUDE_CODE_GOAL_CHECKIN_MINUTES=0` turns check-ins and automatic retries off | S3 | high |
| 3.9 | Works with `claude -p "/goal ..."`, desktop, Remote Control. Unavailable if `disableAllHooks` true or `allowManagedHooksOnly` set; needs workspace trust | S3 | high |
| 3.10 | Combine with /loop: docs present them as alternative approaches in a comparison table ("/loop: Next turn starts when A time interval elapses"). No sentence says they can or cannot be combined. Not found in docs | S3, S1 | n/a |
| 3.11 | Session-only: "Running `/clear` ... also removes any active goal." A goal needs an open (or backgrounded) session; docs for /goal do not mention backgrounding. Not found in docs | S3 | n/a |

## 4. autoContinueAtUsageLimit (S4, S5)
| # | Claim | Source | Conf |
|---|---|---|---|
| 4.1 | Exists in settings reference index: "`autoContinueAtUsageLimit` ... Wait in the open session and continue the task automatically after a claude.ai usage limit resets" ; category "Interface and terminal"; scope "User or managed" | S4 index row | high |
| 4.2 | Detailed entry (default, version) not read: settings-reference is 425k chars, the entry was beyond what the fetch returned. Default value from the key entry: not verified. `settings` page (S9) has no mention | S4, S9 | n/a |
| 4.3 | Behaviour: "Claude Code waits in the open session and continues the task on its own after the limit resets. Automatic continue is on by default in interactive sessions signed in with a claude.ai subscription. Requires Claude Code v2.1.234 or later." | S5 | high |
| 4.4 | "Keep the session open." At reset: "`Usage limit reset · continuing automatically` ... prompts Claude to pick the task up where it stopped. It doesn't resend your last message." | S5 | high |
| 4.5 | Sleep: if computer slept more than about 30 min and limit reset meanwhile, "Press `Enter` to continue" (not automatic) | S5 | high |
| 4.6 | "The continued task runs like any other turn. Claude Code still asks for permissions as usual, so the task can stop on a prompt while you're away." Re-arms "at most twice in a row" then stops: `Automatic continue stopped after repeated usage-limit hits` | S5 | high |
| 4.7 | Cancel: Esc at empty prompt, Ctrl+C, or `/rate-limit-options` "Don't continue automatically". "You exit Claude Code: the wait doesn't restart when you resume the session." Early continue after `/usage-credits`, re-login after `/upgrade`, or `/model` switch | S5 | high |
| 4.8 | Interactive sessions with claude.ai subscription only; API key / non-interactive `-p`: docs say "interactive sessions signed in with a claude.ai subscription" (so `-p` and Console API key not covered) | S5 | medium (inferred from the phrase) |

## 5. Desktop scheduled tasks (S6) and Routines (S7)
| # | Claim | Source | Conf |
|---|---|---|---|
| 5.1 | Comparison table (S1/S6): Cloud routine: min interval 1 hour, machine on "No", open session "No", local files "No (fresh clone)", permission prompts "No (runs autonomously)", customizable "Via `/schedule` in the CLI". Desktop: min 1 minute, machine on "Yes", open session "No", local files "Yes", prompts "Configurable per task" | S1, S6 | high |
| 5.2 | Desktop create: Code tab > Routines > New routine > Local. Not available "On Claude Desktop before 1.1.5368". Also by describing in a session ("set up a daily code review that runs every morning at 9am"). Picker presets: Manual, Hourly, Daily, Weekdays, Weekly; other intervals ("every 15 minutes") by asking Claude | S6 | high |
| 5.3 | "Tasks only run while the desktop app is running and your computer is awake. If your computer sleeps through a scheduled time, the run is skipped." "Keep computer awake" setting available; lid close still sleeps | S6 | high |
| 5.4 | Missed runs: on app start/wake checks last seven days, starts "exactly one catch-up run for the most recently missed time" | S6 | high |
| 5.5 | Permissions: each task has own permission mode; `~/.claude/settings.json` allow rules apply; in Manual mode "the run stalls until you approve it"; "Run now" then "always allow" to avoid stalls; `requiresUserInteraction` MCP tools stall each time | S6 | high |
| 5.6 | Task prompt stored at `~/.claude/scheduled-tasks/<task-name>/SKILL.md`; optional per-run isolated worktree toggle; default runs on working dir state incl. uncommitted changes | S6 | high |
| 5.7 | Routines: "execute on Anthropic-managed cloud infrastructure ... so they keep working when your laptop is closed". Plans: Pro, Max, Team, Enterprise. Research preview. Triggers: scheduled, API (POST /fire, bearer token), GitHub (PR, release events) | S7 | high |
| 5.8 | Create from CLI: "Run `/schedule` in any session ... `/schedule daily PR review at 9am`", alias `/routines`; `/schedule list|update|run`. `/schedule` requires claude.ai subscription login (hidden for Console API key / Bedrock / Vertex / Foundry, and inside cloud sessions) | S7 | high |
| 5.9 | "The minimum interval is one hour; expressions that run more frequently are rejected." Custom cron via `/schedule update`. Top-of-hour runs "can start several minutes late" | S7 | high |
| 5.10 | Routines "run autonomously as full Claude Code cloud sessions: there is no permission-mode picker ... without stopping for approval". Each repo cloned fresh each run (GitHub required); pushes to `claude/`-prefixed branches by default; no local file access | S7 | high |
| 5.11 | Limits: scheduled runs "100 per hour" per account; Run now/API/one-off re-run "30 per hour" per routine; none "has overage". Counts against subscription usage; with usage credits can run on metered overage, else rejected until window resets. GitHub connection lapse: skips up to 72 hours then turns off | S7 | high |
| 5.12 | Routines belong to the individual claude.ai account, not shared; actions appear as you; Team/Enterprise Owner can disable | S7 | high |

## 6. Agent teams (S8)
| # | Claim | Source | Conf |
|---|---|---|---|
| 6.1 | Experimental, off by default: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; needs interactive session (no `-p`) | S8 | high |
| 6.2 | Searched page for /loop, cron, ScheduleWakeup, CronCreate, scheduled: no mention of teammates running /loop or cron, nor of teams + scheduled tasks. Not found in docs | S8 | high (absence in fetched text; fetch was summarised by a model) |
| 6.3 | Teammates are "full, independent Claude Code session[s]" and "load the same project context as a regular session: CLAUDE.md, MCP servers, and skills" (so /loop skill is plausibly available; not documented, not verified) | S8 | medium |
| 6.4 | Keep-working mechanism for teams is hooks: "`TeammateIdle`: runs when a teammate is about to go idle. Exit with code 2 to send feedback and keep the teammate working." Also `TaskCreated`, `TaskCompleted` | S8 | high |
| 6.5 | Limits: "No session resumption with in-process teammates: `/resume` and `/rewind` do not restore in-process teammates"; "One team per session"; "No nested teams"; "a teammate's background work can't outlive the lead's process"; teammate permission prompts surface in lead session | S8 | high |
| 6.6 | Team config dir removed at session end; task list dir persists locally under `~/.claude/tasks/{team-name}/` | S8 | high |

## Contradictions / gaps
- None between sources. Tension to watch: S1 table says /loop is "Restored on `--resume`" but self-paced loops are not restored (S1 Limitations); S2 says backgrounding keeps loops alive across terminal close, S1 says closing terminal stops them (resolved: only if not backgrounded).
- Not found in docs: whether `/goal` and `/loop` can be combined; whether a goal keeps running in a backgrounded session; teammate use of /loop or cron; default value and introduction version of `autoContinueAtUsageLimit` from its own settings entry (only index row + interactive-mode section read; behaviour says on by default for claude.ai subscription interactive sessions, v2.1.234+); minimum version for `--bg`/`/bg`.
- Not read: agent-view text after char 100000 (version history), settings-reference after char 300000.
- Fetch results were produced by a summarising model for S2, S4, S5-adjacent; quotes in S1, S3, S5 (read from saved raw text), S6, S7, S8 came back as full page text.
