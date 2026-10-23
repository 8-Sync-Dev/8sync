# loop-harness-r2: unattended Claude Code on subscription OAuth — evidence notes

Read date: 2026-10-16. Not legal advice. Live pages fetched via WebFetch (summarising model; quotes below were returned as verbatim, local snapshots grep'd directly, treat live quotes as "high but re-check before citing in a public doc").

## Sources
- S1 `C:\Users\Projects\su-code\docs\legal\anthropic\consumer-terms.md` (snapshot 2026-10-12 per index.md; doc "Effective October 8, 2025")
- S2 `...\anthropic\claude-code-legal-and-compliance.md` (snapshot 2026-10-12) — also live https://code.claude.com/docs/en/legal-and-compliance (S3, fetched 2026-10-16, text identical on the points quoted)
- S4 `...\anthropic\usage-policy.md` (snapshot 2026-10-12)
- S5 https://code.claude.com/docs/en/scheduled-tasks (2026-10-16)
- S6 https://code.claude.com/docs/en/routines (2026-10-16; "research preview")
- S7 https://code.claude.com/docs/en/desktop-scheduled-tasks (2026-10-16)
- S8 https://code.claude.com/docs/en/costs (2026-10-16)
- S9 https://code.claude.com/docs/en/channels (2026-10-16; "research preview")
- S10 https://code.claude.com/docs/en/agent-view (2026-10-16; only chars 0-100000 of 137050 read)
- S11 https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work (2026-10-16)
- S12 https://support.claude.com/en/articles/14552983-models-usage-and-limits-in-claude-code (2026-10-16)
- S13 `C:\Users\Admin\.claude\skills\aup-audit\8sync-anthropic-rules.md` (8 Sync internal; header "Cập nhật: 2026-10-11")
- S14 `...\anthropic\commercial-terms.md` (snapshot 2026-10-12)

## Q1. "Automated or non-human means" + which terms govern Team

| # | Claim (verbatim) | Source | Date | Confidence |
|---|---|---|---|---|
| 1 | Consumer Terms s.3, prohibited use: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise." | S1 consumer-terms.md:28 | snapshot 2026-10-12; terms eff. 2025-10-08 | High (local file, grep) |
| 2 | Consumer Terms scope: "These Terms of Service ("Terms") govern your use of Claude.ai, Claude Pro, and other products and services that we may offer for individuals..." and "Our Commercial Terms of Service govern your use of any Anthropic API key, the Anthropic Console, or any other Anthropic offerings that reference the Commercial Terms of Service. For clarity, this does not include Claude.ai or Claude Pro use for individuals or entities." | S1 consumer-terms.md:6-8 | same | High |
| 3 | Claude Code license split: "Commercial Terms of Service - for Team, Enterprise, and Claude API users"; "Consumer Terms of Service - for Free, Pro, and Max users" | S2 claude-code-legal-and-compliance.md:13-14; S3 live | 2026-10-12 / 2026-10-16 | High. So Team is Commercial for Claude Code, Pro/Max is Consumer. |
| 4 | Commercial Terms snapshot has no "automated or non-human means" clause (grep for "non-human" over all snapshots returned only consumer-terms.md:28). | S14 (grep) | 2026-10-12 | Medium: absence by grep only; I did not read all of commercial-terms.md. |
| 5 | The "explicitly permit" carve-out exists in the clause itself ("or where we otherwise explicitly permit it"). Anthropic's own docs explicitly provide /loop, Desktop tasks, Routines, background sessions (see Q2), so using those features is Anthropic-permitted by design. Whether a specific third-party-driven trigger counts is not addressed by any source. | S1:28 + S5-S10 | 2026-10-16 | Inference, labelled as such. |

## Q2. What Anthropic provides for unattended runs

| # | Claim (verbatim) | Source | Date | Confidence |
|---|---|---|---|---|
| 6 | Pointer to unattended options: "For cron-driven automation that needs to run unattended: Routines: run in the cloud on a schedule, via API call, or on GitHub events; GitHub Actions: use a `schedule` trigger in CI; Desktop scheduled tasks: run locally on your machine" | S5 Limitations section | 2026-10-16 | High |
| 7 | /loop is session-scoped: "Tasks only fire while Claude Code is running and idle. Closing the terminal or letting the session exit stops them firing. Backgrounding the session carries `/loop` tasks over to a background session, which keeps running without a terminal." | S5 Limitations | 2026-10-16 | High |
| 8 | Limits of in-session cron: "A session can hold up to 50 scheduled tasks at once." "Recurring tasks automatically expire 7 days after creation. The task fires one final time, then deletes itself. This bounds how long a forgotten loop can run." "No catch-up for missed fires." Min interval /loop 1 minute. Fires "between your turns, not while Claude is mid-response." | S5 | 2026-10-16 | High |
| 9 | CronCreate is a first-class tool: "`CronCreate` Schedule a new task. Accepts a 5-field cron expression, the prompt to run, and whether it recurs or fires once." Kill switch: "Set `CLAUDE_CODE_DISABLE_CRON=1` ... to disable the scheduler entirely." Tasks may also be created by asking Claude in natural language. | S5 | 2026-10-16 | High |
| 10 | Background sessions: "Each background session is a full Claude Code conversation that keeps running without a terminal attached" and "Background sessions don't need any terminal open to keep working. A separate supervisor process runs them". Limits: "background sessions consume your subscription usage the same as interactive sessions, so running ten agents in parallel uses quota roughly ten times as fast as running one." "Sessions are local: ... preserved across sleep but stop if the machine shuts down." Agent view is "in research preview". Plan availability: not verified. | S10 | 2026-10-16 | Medium-high (page 27% unread) |
| 11 | Routines: "Routines are available on Pro, Max, Team, and Enterprise plans." "Put Claude Code on autopilot." Use cases "unattended, repeatable, and tied to a clear outcome." "Routines run autonomously as full Claude Code cloud sessions: there is no permission-mode picker". "Routines are in research preview. Behavior, limits, and the API surface may change." Team/Enterprise Owners can disable them org-wide. | S6 | 2026-10-16 | High |
| 12 | Desktop scheduled tasks: "A local task runs on your machine ... but only fires while the app is open and your computer is awake." "If your computer sleeps through a scheduled time, the run is skipped." Catch-up: "Desktop starts exactly one catch-up run for the most recently missed time." Permissions: if in Manual mode and tool not allowed "the run stalls until you approve it." | S7 | 2026-10-16 | High |
| 13 | Comparison table row: Permission prompts - Cloud "No (runs autonomously)", Desktop "Configurable per task", /loop "Inherits from session". Requires open session - Cloud No, Desktop No, /loop Yes. Min interval - Cloud 1 hour, Desktop 1 minute, /loop 1 minute. | S5, S7 | 2026-10-16 | High |
| 14 | Channels (closest to "message into a running session"): "A channel is an MCP server that pushes events into your running Claude Code session, so Claude can react to things that happen while you're not at the terminal." "Events only arrive while the session is open, so for an always-on setup you run Claude in a background process or persistent terminal." Needs `--channels`; during preview only Anthropic allowlist (or org allowlist) plugins, else `--dangerously-load-development-channels`. "Team and Enterprise organizations must explicitly enable them" (`channelsEnabled`). "Pro and Max users without an organization skip these checks entirely". | S9 | 2026-10-16 | High |
| 15 | Unattended permission note in Channels doc: "For unattended use, `--dangerously-skip-permissions` bypasses most prompts, but only use it in environments you trust." (Org rule in CLAUDE.md forbids using it in our setup; see Q5.) | S9 | 2026-10-16 | High |
| 16 | Docs-acknowledged cross-session messaging exists: "Claude Code delivers a message from another of your sessions as a new turn when this session sits idle ... To hold inbound messages instead of delivering them, set `crossSessionInbound` to `hold`." Page /docs/en/cross-session-messaging not fetched. | S8 (Why usage climbs) | 2026-10-16 | Medium (secondhand via costs page) |
| 17 | GitHub Actions: only referenced as a `schedule` trigger option; github-actions page not fetched. | S5 | 2026-10-16 | Low-medium; not verified beyond pointer |

## Q3. Limits bounding such loops

| # | Claim (verbatim) | Source | Date | Confidence |
|---|---|---|---|---|
| 18 | "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." | S2 :46 (live S3) | 2026-10-12/16 | High |
| 19 | Team/Enterprise: "each member's Claude Code usage draws from a per-seat allowance that resets on a rolling five-hour window and a weekly window. The allowance is shared with Claude chat and Cowork, and its size depends on the member's seat tier (Standard or Premium)." No numbers given. | S8 | 2026-10-16 | High (no figures) |
| 20 | Paid plans: "a session limit that resets every five hours" and "weekly limits that reset once every week"; page gives no Claude Code allowances ("counts towards the same usage limit"). | S11 | 2026-10-16 | Medium-high (paraphrase-quoted by fetch model) |
| 21 | Hitting a limit: "You've hit your session limit" / "weekly limit" is "a seat-based usage window on a subscription plan, shared across all models, so the developer can't restore access by switching models". Claude Code v2.1.234+ can "wait and continue the interrupted task automatically after the reset" (`autoContinueAtUsageLimit`). Usage credits extend past limit; none stated to be on by default. | S8 | 2026-10-16 | High |
| 22 | Routine hourly caps (stated): scheduled runs incl. one-off "100 per hour" per account (run "waits until the limit resets"); Run now + API fires + one-off re-run "30 per hour" per routine; Run now/one-off re-run "100 per hour" per account; API fires "100 per hour" per account; "None of these hourly limits has overage." Minimum schedule interval "one hour". Not a per-plan table; no plan-specific caps stated. No daily cap stated. | S6 Usage and limits | 2026-10-16 | High |
| 23 | "Routines draw down subscription usage the same way interactive sessions do." Over limit: "organizations with usage credits turned on can keep running routines on metered overage. Without usage credits, additional runs are rejected until your usage window resets." Routines "belong to your individual claude.ai account. They are not shared with teammates". | S6 | 2026-10-16 | High |
| 24 | Scheduled tasks cost: "a scheduled task fires on its interval even while the session is idle, sending your full context each time." `/usage` has a Loops row listing heaviest loops (v2.1.242+). Prompt-cache lifetime "an hour on a subscription". | S8 | 2026-10-16 | High |
| 25 | Exact 5-hour / weekly token or message numbers for Pro/Max/Team: not stated in any primary source I read. S12 (Claude Code limits article) only describes Enterprise seat and API key metering. A third-party guide (ccforeveryone.com, 2026-08-05) claims 5-hour limits were doubled in May; secondary, not used. | S11, S12 | 2026-10-16 | not verified |

## Q4. Anything that makes a third-party CLI (8sync) injecting one message into a session inbox via a plugin hook problematic

| # | Claim (verbatim) | Source | Date | Confidence |
|---|---|---|---|---|
| 26 | OAuth purpose: "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications." | S2:52 / S3 | 2026-10-16 | High |
| 27 | Proxying/credentials: "Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." | S2:53 / S3 | 2026-10-16 | High |
| 28 | Own-use is expressly fine: "Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription". Binary condition: "The Claude Code binary must not be modified. Claude Code must be installed and run as published by Anthropic" (stated as condition for offering Claude Code in products, not for ordinary personal use). | S2:55, :23 / S3 | 2026-10-16 | High |
| 29 | AUP: "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used" | S4 usage-policy.md:134 | 2026-10-12 | High |
| 30 | AUP: "Utilize automation in account creation or to engage in spammy behavior"; "Coordinate malicious activity across multiple accounts, or create multiple accounts, to avoid detection, circumvent product guardrails..." | S4:127-128 | 2026-10-12 | High |
| 31 | Rate-limit caveat: "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." | S2/S3 | 2026-10-16 | High |

Analysis (inference, not Anthropic statement; not legal advice):
- Design under review: 8sync (local CLI, owner's machine) puts one message into an already-running, owner-authenticated, unmodified Claude Code session; the session itself calls its own `CronCreate`. Claude Code makes all API calls with the owner's own OAuth login; 8sync never sees/handles the token, never proxies requests, never modifies the binary. On those facts it does not match #27 (no routing/collecting of credentials), #29 (no proxy/misrepresented client), #28 (unmodified binary, own subscription). It is a local script triggering a first-party feature, similar in kind to Anthropic's own documented Channels ("pushes events into your running Claude Code session") and webhooks.
- Residual risk A (Consumer Terms, Pro/Max accounts): #1 forbids accessing the Services "through automated or non-human means, whether through a bot, script, or otherwise" unless "explicitly permit[ted]". A script that pokes a prompt is arguably "script"-driven access, but the API call itself is made by Claude Code; the clause is not interpreted anywhere in the sources. Anthropic's explicit /loop, Routines, Desktop tasks, background sessions and Channels are the documented permitted routes. Using the official Channels mechanism (or Anthropic-listed plugin route) is safer than an ad-hoc inbox injection. Not verified how Anthropic would treat a custom hook-based injector.
- Residual risk B (ordinary use): #18/#26 tie subscription limits/OAuth to "ordinary, individual usage"/"ordinary use". Always-on loops across many rooms/sessions in parallel burn quota faster (#10 "ten agents ... ten times as fast"). "Ordinary" is undefined in any source read. Fleet of parallel loops at 5-min cadence (the cheapest-cache cadence per S5) 24/7 is a judgement call; not verified whether it is "ordinary".
- Residual risk C (Team plan): Team is under Commercial Terms for Claude Code (#3) which has no found automated-means clause (#4, grep only). But OAuth for Team is "ordinary use" (#26), and Channels need an Owner to enable `channelsEnabled` (#14). Admin/Owner can disable Routines (#11). A custom channel plugin in a Team org needs `allowedChannelPlugins` or `--dangerously-load-development-channels` (#14).
- Residual risk D (not Anthropic's law but design): permission prompts stall an unattended session (#12, #14); the only documented workaround is `--dangerously-skip-permissions`, which user CLAUDE.md forbids.
- Seven-day expiry (#8) means the self-set loop must be recreated; this is by design to bound forgotten loops. Self-recreating cron every 7 days by script is not addressed by docs; it does not circumvent a safety control but defeats the stated purpose ("This bounds how long a forgotten loop can run"): recommend owner-visible renewal. Judgement.

## Q5. 8 Sync rules (S13, "Cập nhật: 2026-10-11") vs Anthropic

| # | Point | Source | Stricter than Anthropic? |
|---|---|---|---|
| 32 | "token subscription (Pro/Max) chỉ dùng trong Claude Code & Claude.ai chính chủ. Tool bên thứ ba → bắt buộc dùng API key qua Console. Proxy/giả client = vi phạm AUP" (S13:18) | S13:18 | Yes, stricter: Anthropic bars routing/credential collection (#27) and permits user signing into the unmodified binary on their own (#28); S13 forbids any third-party tool using subscription token at all. 8sync driving a first-party session does not use the token itself, so it is consistent with both. |
| 33 | "Agentic: bạn chịu trách nhiệm cho mọi hành động agent làm qua tools/browser/hệ thống kết nối. → setup 'treo auto'." (S13:43) | S13:43 | Same as AUP/Consumer s.4 (user responsible for Actions); S13 adds explicit flag on "treo auto". Not stricter. |
| 34 | Violation ladder "cảnh báo -> throttle -> giới hạn -> suspend -> terminate. Không 'lập acc mới' để né." (S13:47-48) | S13 | Summary of AUP; S4 only confirmed lines 127-129 (ban evasion); ladder wording not verified in S4. |
| 35 | S13 does not mention the Consumer Terms "automated or non-human means" clause (S1:28) nor "ordinary, individual usage" (S2:46). Its table says Claude Code login is "Consumer Terms (cá nhân) hoặc Team/Enterprise terms" (S13:15), consistent with #3. Gap: S13 should add the S1:28 clause and the S2:46 sentence for unattended loops. | S13:15 | Gap, not stricter |
| 36 | S13 header says it links "Consumer Terms of Service: https://www.anthropic.com/legal/terms" (S13:71) while snapshot index lists `/legal/consumer-terms`. Possible stale link. | S13:71 vs index.md | n/a |
| 37 | Org CLAUDE.md (not S13): "Không dùng `bypassPermissions`/`--dangerously-skip-permissions`." Anthropic docs allow it for trusted environments (#15). 8 Sync is stricter. | C:\Users\Admin\.claude\CLAUDE.md (injected context) | Yes |
| 38 | 8 Sync Q&A rule "Tool bên thứ ba dùng API key Console" + org "ZUS local-first/no secrets" are internal. `/schedule` and Routines need claude.ai login, not Console key (S6): 8 Sync's "third-party => API key" rule does not apply to Anthropic first-party routines. | S6, S13:18 | clarification |

## Contradictions / tensions
- Docs say Routines run "autonomously" with no permission picker (#11, #13) while /loop "Inherits from session" permissions (#13): unattended /loop on a session with default prompts stalls (#12, #14). Not a contradiction in source, but a practical block.
- Consumer Terms "non-human means ... bot, script" (#1) vs Anthropic documenting scheduled/background/automated features (#6-#14): reconciled only by the "explicitly permit" carve-out; no source says how far it extends to third-party triggers.
- scheduled-tasks page says loops stop when session exits (#7) yet Backgrounding carries them over (#7); costs page says scheduled tasks fire "even while the session is idle" (#24). Consistent: idle = ok, exited = not.
- S13 cite for Consumer Terms URL differs from snapshot URL (#36).

## Not found / not verified
- Any numeric 5-hour or weekly cap for Pro/Max/Team (S11, S12 give none).
- Any definition of "ordinary use" / "ordinary, individual usage".
- Any statement permitting or prohibiting a third-party local script injecting prompts into a user's own Claude Code session (outside Channels).
- Plan availability for background sessions/agent view (page partially read, 37k chars unread).
- Routines per-plan daily caps: none stated; only hourly caps (#22).
- GitHub Actions page, cross-session-messaging page, hooks/plugin docs not fetched.
- Whether Commercial Terms contain any automation clause (only grep; full read not done).
- Whether Team seats count as "individual usage" for the S2:46 sentence (sentence names Pro and Max only).
