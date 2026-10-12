# ccc-harness-next — Part A (legal constraints) + Part B (ccc inventory and gaps)

Read 2026-10-13. Read-only research; no conclusions, no code edits. Not legal advice.
Local paths are relative to C:\Users\Projects\su-code. Live pages fetched with WebFetch (narrow prompts; WebFetch summarises through a small model, so quotes marked "live" should be re-checked against the page before they go in public text).

## Source ids

| id | Source | Version / date read |
|---|---|---|
| S1 | docs/legal/anthropic/usage-policy.md (snapshot of anthropic.com/legal/aup) | header "Effective November 12, 2026"; snapshot 2026-10-12 (docs/legal/anthropic/index.md:3) |
| S2 | https://www.anthropic.com/legal/aup (live) | "Effective November 12, 2026", read 2026-10-13 |
| S3 | https://www.anthropic.com/legal/archive/22742366-2ef0-4c7a-a833-6523f10d3944 (AUP "Previous Version", linked from S2) | "Effective September 15, 2025" |
| S4 | docs/legal/anthropic/consumer-terms.md (+ live https://www.anthropic.com/legal/consumer-terms) | "Effective October 8, 2025" (both agree) |
| S5 | docs/legal/anthropic/commercial-terms.md | "Effective June 17, 2025" |
| S6 | docs/legal/anthropic/claude-code-legal-and-compliance.md (+ live https://code.claude.com/docs/en/legal-and-compliance, identical text) | read 2026-10-13 |
| S7 | assets/skills/aup-audit/8sync-anthropic-rules.md | "Cập nhật: 2026-10-11" (line 4) |
| S8 | https://code.claude.com/docs/en/agent-sdk/overview | read 2026-10-13 |
| S9 | https://code.claude.com/docs/en/headless | read 2026-10-13 (Claude Code 2.1.2xx notes) |
| S10 | https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan | update notes "October 7, 2026" and "June 15, 2026" |
| S11 | https://code.claude.com/docs/en/agent-teams | read 2026-10-13 |
| S12 | https://code.claude.com/docs/en/channels | read 2026-10-13 |
| S13 | https://code.claude.com/docs/en/hooks (first 200k chars of 268k) | read 2026-10-13 |
| S14 | https://code.claude.com/docs/en/goal | read 2026-10-13 |
| S15 | https://code.claude.com/docs/en/scheduled-tasks | read 2026-10-13 |
| S16 | https://code.claude.com/docs/en/plugin-marketplaces | read 2026-10-13 |
| S17 | https://code.claude.com/docs/en/llm-gateway | read 2026-10-13 |
| S18 | https://github.com/anthropics/claude-code/blob/main/LICENSE.md | read 2026-10-13 |
| S19 | THIRD_PARTY_NOTICES.md:1-40 (Feynman MIT adaptation) | local |
| S20 | docs/hq.md:9-10, 22, 35, 37 | local |
| S21 | crates/cli/src/verbs/ccc.rs (+ ccc/guard.rs, danger.rs, gate.rs, verify.rs) | local, HEAD e4c94fa |
| S22 | README.md:89-146, 202-226 | local |
| S23 | su-code/STATE.md:1-32 (Unreleased after v0.66.0) | local |
| S24 | https://www.anthropic.com/legal/aup via WebSearch result summary of third-party blogs on the May 13 2026 Agent SDK credit change (gist.github.com/MagnaCapax/..., venturebeat) | secondary only, used only to explain S10 |

---

# Part A — legal constraints by idea class

Verdict key: ALLOWED / CONDITIONS / NOT ALLOWED / NO CLAUSE FOUND (not the same as allowed).

## A0. What changed recently (read first)

| # | Claim (verbatim) | Source | Date | Confidence |
|---|---|---|---|---|
| A0.1 | Live AUP header: "Effective November 12, 2026" with a "Previous Version" link. Today is 2026-10-13, so the live page shows a version dated in the future. The page gives no changelog and no statement of what is in force until 11-12. Whether the new text is already enforced is not verified. | S2; S1:4 | 2026-10-13 | high that the header says this; not verified what is enforced today |
| A0.2 | Previous AUP version: "Effective September 15, 2025". Its "Do Not Abuse our Platform" list had 6 bullets, no "Resell, proxy..." bullet, no "evade payment" bullet; the training bullet read "Utilization of inputs and outputs to train an AI model (e.g., "model scraping" or "model distillation")"; agentic line read "Agentic use cases must still comply with the Usage Policy." | S3 (live fetch summary) | 2026-10-13 | medium (small-model summary; bullets were truncated at 125 chars) |
| A0.3 | New (11-12) AUP adds: "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used"; "Use stolen, fraudulent, or unauthorized payment methods, or otherwise evade payment for our services"; training bullet narrowed to "Use outputs to train an AI model (e.g., "model scraping" or "model distillation") without prior authorization from Anthropic"; agentic line now "Users are responsible for ensuring that agents they build or deploy, including actions those agents take through tools, browsers, or connected systems, comply with this Usage Policy." | S1:127-134, S1:197; S2 | 2026-10-12/13 | high (snapshot and live agree) |
| A0.4 | AUP now has three tiers: "Universal Usage Standards", "High-risk Use Case Requirements", "Additional Use Case Guidelines" (consumer-facing chatbots and agents, minors, agentic use, software in directories). | S1:10-12 | 2026-10-12 | high |
| A0.5 | Agent SDK / `claude -p` billing: "Update June 15, 2026: We've paused the previously-announced changes to Claude Agent SDK usage." and "Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits." Then "Update October 7, 2026: Claude Max and Team plans now include monthly API credits ... which cover the Claude Agent SDK, claude -p, the Claude API, and Claude Managed Agents. You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits." | S10 | 2026-10-07 | high that the notes say this; article body beyond the notes not read |
| A0.6 | Background: the paused change (announced 2026-05-13) would have moved Agent SDK, `claude -p`, GitHub Actions and third-party auth off subscription limits onto a separate credit pool. Only secondary sources found; one blog (tygartmedia, "last verified October 5, 2026") still says it is in effect and conflicts with S10. | S24 (secondary) | 2026-10 | low; S10 is the primary and wins |
| A0.7 | Consumer Terms still "Effective October 8, 2025", Commercial Terms still "Effective June 17, 2025": no change in these two since the repo snapshot. | S4:4, S5:4 | 2026-10-13 | high |
| A0.8 | The repo rules doc (S7, dated 2026-10-11) already cites "Do Not Abuse Our Platform" for proxy/fake client (S7:18, S7:35) but the old AUP did not contain the proxy bullet (S3). The rule is covered by the Nov 12 text and by S6, not by the pre-Nov-12 AUP. | S7:18,35 vs S3 | 2026-10-13 | medium |

## A1. Headless or scheduled `claude -p`: subscription vs Console key

| # | Claim | Source | Date | Confidence |
|---|---|---|---|---|
| A1.1 | Consumer Terms s.3: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise." | S4:28 | 2025-10-08 | high |
| A1.2 | "where we otherwise explicitly permit it" is the hook: Anthropic's own help article says "You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits." | S10 | 2026-10-07 | medium (help article, not a Terms amendment) |
| A1.3 | Claude Code legal page: "Claude Code usage is subject to the Anthropic Usage Policy. Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK." | S6 "Acceptable use" | 2026-10-13 | high |
| A1.4 | OAuth is "intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications." Developers building products "should use API key authentication through Claude Console or a supported cloud provider." | S6 "Authentication and credential use" | 2026-10-13 | high |
| A1.5 | Docs say bare mode does not use the subscription: "Set `ANTHROPIC_API_KEY` before running it, because bare mode doesn't use your subscription login"; "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release." | S9 | 2026-10-13 | high |
| A1.6 | Scheduling: `/loop` is session-scoped, 7-day expiry for recurring tasks; durable options are cloud Routines (min 1 h, "runs autonomously"), Desktop scheduled tasks, GitHub Actions. | S15 | 2026-10-13 | high |

Verdict:
- Console key (`ANTHROPIC_API_KEY`, `--bare -p`, cron/CI): ALLOWED (A1.1 exception "via an Anthropic API Key"; Commercial Terms apply, S5 D.2).
- Own subscription, own machine, `claude -p` or scheduled (cron calling the unmodified Claude Code binary): CONDITIONS. Anthropic's help article says it still draws from subscription limits (A1.2); legal page says limits assume "ordinary, individual usage" (A1.3). No numeric cap and no definition of "ordinary" found. Not verified whether a 24/7 cron fleet counts as ordinary. docs/hq.md:35 already says a 24/7 fleet "is therefore not 'ordinary, individual usage'" and flags the seat rule as "not verified" (S20).
- Scripts that log in with a subscription token outside Claude Code, or serve other people from one subscription: NOT ALLOWED (A1.4; S1:134 after 11-12).

## A2. Several parallel Claude Code sessions / agent teams on one subscription

| # | Claim | Source | Confidence |
|---|---|---|---|
| A2.1 | Agent teams: "Agent teams are experimental and disabled by default."; "Agent teams use significantly more tokens than a single session. Each teammate has its own context window, and token usage scales with the number of active teammates." No hard limit: "There's no hard limit on the number of teammates"; suggested "Start with 3-5 teammates". | S11 | high |
| A2.2 | Teammates are "Separate Claude Code instances" run by the lead session; not a Terms issue per se. In `-p` "Claude doesn't spawn teammates". | S11 | high |
| A2.3 | Consumer Terms s.2: "You may not share your Account login information, Anthropic API key, or Account credentials with anyone else. You also may not make your Account available to anyone else." | S4:14 | high |
| A2.4 | AUP (new): "Coordinate malicious activity across multiple accounts, or create multiple accounts, to avoid detection, circumvent product guardrails, or generate identical or similar inputs that otherwise violate our Usage Policy" (concerns multiple accounts, not multiple sessions). | S1:127 | high |
| A2.5 | Docs list manual parallel sessions as supported: "Git worktrees let you run multiple Claude Code sessions yourself". | S11 "Next steps" | high |

Verdict: CONDITIONS. Several sessions or a team under ONE person's login are the documented feature (A2.1, A2.5); the limit is the plan's usage limit plus "ordinary, individual usage" (A1.3). NOT ALLOWED: one login used by several people (A2.3) or several accounts to get more capacity (A2.4 "create multiple accounts ... circumvent product guardrails"). No clause on a maximum session count found.

## A3. Discord / Slack / Channels bots that relay owner messages into Claude Code

| # | Claim | Source | Confidence |
|---|---|---|---|
| A3.1 | "Channels are in research preview. They require Anthropic authentication through claude.ai or a Console API key ..."; "Telegram, Discord, and iMessage are included in the research preview." Plugins from `claude-plugins-official`. | S12 | high |
| A3.2 | Security: "Every approved channel plugin maintains a sender allowlist: only IDs you've added can push messages, and everyone else is silently dropped." Warning: "Anyone who can reply through the channel can approve or deny tool use in your session, so only allowlist senders you trust with that authority." | S12 "Security" | high |
| A3.3 | Enterprise: "claude.ai Team and Enterprise: channels are blocked until an Owner enables them." Setting `channelsEnabled`. "Pro and Max users without an organization skip these checks entirely". | S12 | high |
| A3.4 | "Events only arrive while the session is open, so for an always-on setup you run Claude in a background process or persistent terminal." | S12 | high |
| A3.5 | Developers "may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow." | S6 | high |
| A3.6 | Slack: "Claude in Slack: Spawns a cloud session from an `@Claude` mention" is Anthropic's own integration. | S12 "How channels compare" | high |
| A3.7 | AUP: "All consumer-facing chatbots or AI agents that communicate directly with external users must disclose to users that they are interacting with AI rather than a human." | S1:195 | high |

Verdict:
- Owner-only relay through Anthropic's official Channels plugin (allowlist = owner), in the official unmodified client: ALLOWED (documented feature).
- Own bot that forwards messages into `claude -p` / SDK using a subscription token: NOT ALLOWED (A3.5; S6 "route requests through Free, Pro, or Max plan credentials on behalf of their users"). Console key required.
- Bot talking to people other than the owner (customers, team): CONDITIONS: AI disclosure (A3.7); each person who drives Claude with their own login or a key billed to the key owner (S6 "Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf").
- Not verified: Channels under a Team org with `channelsEnabled` (S23 / v0.66.0 STATE "Not verified: ... Channels plugin under a Team org").

## A4. Hooks that call Claude (prompt / agent hooks)

| # | Claim | Source | Confidence |
|---|---|---|---|
| A4.1 | "Prompt hooks (`type: "prompt"`): send a prompt to a Claude model for single-turn evaluation. The model returns its decision as JSON." "Agent hooks (`type: "agent"`): spawn a subagent that can use tools like Read, Grep, and Glob to verify conditions before returning a decision. Agent hooks are experimental and may change." | S13 (hooks, handler types) | high |
| A4.2 | `model`: "Model to use for evaluation. Defaults to the model Claude Code uses for background functionality." Timeouts "30 for `prompt`; 60 for `agent`". | S13 | high |
| A4.3 | `/goal` "is a wrapper around a session-scoped prompt-based Stop hook"; evaluator billed on "the small fast model configured for your provider". | S14 | high |
| A4.4 | In `-p` "a session runs the hooks in a project's `.claude/settings.json` ... even in a folder you've never trusted", unless `--bare`. | S9 | high |

Verdict: ALLOWED. These are first-party Claude Code features running inside the same client and login; no clause restricts them. CONDITIONS only on cost and on content: whatever the hook sends (transcript, tool input) goes to Anthropic like any prompt, so client data rules apply (S7 section 3). Cost: kit's retired Haiku Stop gate cost ~30k tokens per turn end (S21 gate.rs:3-6).

## A5. Sharing a kit as a public plugin

| # | Claim | Source | Confidence |
|---|---|---|---|
| A5.1 | "Offering a plugin to everyone: submit it to Anthropic's directory." Own marketplace = a git repo with `.claude-plugin/marketplace.json`; "The repository can be private". | S16 | high |
| A5.2 | Reserved names: "exact official marketplace names, such as `claude-plugins-official` ... Claude Code refuses it with a message that starts `The name '<name>' is reserved for official Anthropic marketplaces`." | S16 | high |
| A5.3 | Naming: "you can't use the Claude Code or Anthropic names or logos as part of your own product, feature, or company name, in your own logo, or in a way that suggests Anthropic built, endorses, or is partnered with your product." Plain-text "runs Claude Code" is fine. Agent SDK branding: not permitted "Claude Code" or "Claude Code Agent"; "Claude Code-branded ASCII art or visual elements that mimic Claude Code". | S6 "Using the Claude Code name and logo"; S8 "Branding guidelines" | high |
| A5.4 | Software listed in Anthropic directories "must comply with our Software Directory Policy." Policy text not fetched. | S1:197 | high that the line exists; policy not read |
| A5.5 | Repo already has a public marketplace: README "/plugin marketplace add 8-Sync-Dev/su-code" "/plugin install 8sync-kit@8sync" (plugin name "8sync-kit", marketplace "8sync"). Local file .claude-plugin/marketplace.json exists (content not re-read). | S22:105-110 | high |

Verdict: ALLOWED with CONDITIONS: own marketplace name (not `claude-plugins-official`); no Anthropic/Claude Code names or logos in product or plugin name; third-party content licences respected (A10); no secrets in the plugin; hooks in a public plugin run arbitrary commands, so the repo's guard/policy limits should be documented. Directory submission needs the Software Directory Policy (not read).

## A6. Using Claude output to build evals

| # | Claim | Source | Confidence |
|---|---|---|---|
| A6.1 | AUP (from 11-12): "Use outputs to train an AI model (e.g., "model scraping" or "model distillation") without prior authorization from Anthropic". | S1:133 | high |
| A6.2 | Commercial Terms D.4: "Customer may not and must not attempt to (a) access the Services to build a competing product or service, including to train competing AI models or resell the Services except as expressly approved by Anthropic". | S5:20 | high |
| A6.3 | Commercial Terms B: "Customer (a) retains all rights to its Inputs, and (b) owns its Outputs." | S5:13 | high |
| A6.4 | Consumer Terms s.3: "To develop any products or services that compete with our Services, including to develop or train any artificial intelligence or machine learning algorithms or models or resell the Services." | S4:23 | high |
| A6.5 | D.3: "Customer acknowledges, and must notify its Users, that factual assertions in Outputs should not be relied upon without independently checking their accuracy". | S5:19 | high |

Verdict: ALLOWED for evals that only measure (golden sets, graders, regression benches; no model is trained on Claude outputs; the product does not compete with Anthropic). NOT ALLOWED: using Claude outputs as training or fine-tuning data for any model (A6.1, A6.4; Commercial D.4(a) if competing). CONDITIONS: if an eval set later feeds fine-tuning, get "prior authorization from Anthropic" first. No clause found that bans LLM-as-judge or building test cases from outputs.

## A7. Auto-continue loops and automated outward actions

| # | Claim | Source | Confidence |
|---|---|---|---|
| A7.1 | Stop-hook loop guard: "The `stop_hook_active` field is `true` when Claude Code is already continuing as a result of a stop hook. Check this value or process the transcript to avoid blocking on a condition that will never resolve." Cap: "after stop hooks have continued the turn eight times in a row, Claude Code overrides the next block and ends the turn ... To raise the cap, set `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`." | S13 (Stop input) | high |
| A7.2 | `/goal` "Claude keeps working toward it without you prompting each step"; "A goal doesn't change your permission mode"; `-p "/goal ..."` "runs the loop to completion in a single invocation". Auto-clears on credit exhaustion or auth failure. | S14 | high |
| A7.3 | `/loop` built-in maintenance prompt: "irreversible actions such as pushing or deleting only proceed when they continue something the transcript already authorized." | S15 | high |
| A7.4 | AUP agentic: "Users are responsible for ensuring that agents they build or deploy, including actions those agents take through tools, browsers, or connected systems, comply with this Usage Policy." | S1:197 | high |
| A7.5 | Anthropic's own agent-to-agent rule: "A teammate can't approve a permission prompt or supply consent on your behalf". | S11 "Messages between agents" | high |
| A7.6 | AUP prohibits: "Utilize automation in account creation or to engage in spammy behavior"; "Promote or facilitate the generation or distribution of spam"; "Generate automated calls or messages to voters or public officials at scale that conceal their artificial origin"; bots "that claim to be human". | S1:128, S1:~51 (spam bullet), S1:97, S1:89 | high |
| A7.7 | Loop duration: "Recurring tasks automatically expire 7 days after creation"; "irreversible ... pushing or deleting". `--max-budget-usd` exists for `-p` runs. | S15, S9 | high |

Verdict: ALLOWED: auto-continue within one session (Stop hook, `/goal`, `/loop`) is a documented feature, with the 8-continuation cap and `stop_hook_active` guard. CONDITIONS on outward actions: the operator owns every action (A7.4); keep a human gate on irreversible or external actions (S7:43 "setup treo auto"); messaging real people must not be spam, must disclose AI (S1:195), and must have consent (S1:57 privacy). No clause bans auto-push or auto-deploy to the user's own repo/infra. NOT ALLOWED: mass or deceptive outbound messaging, fake personas (S1:85,89).

## A8. Memory that stores user or client data

| # | Claim | Source | Confidence |
|---|---|---|---|
| A8.1 | AUP: "Violate privacy rights as defined by applicable privacy laws, such as sharing personal information without consent or accessing private data unlawfully"; "Compile, aggregate, or enrich personal data from multiple sources to build profiles of individuals for sale, licensing, or disclosure to third parties without those individuals' awareness and agreement". | S1:57, S1:59 | high |
| A8.2 | Commercial Terms: "Customer Content is Customer's Confidential Information." Customer owns Outputs. "Anthropic may not train models on Customer Content from Services." | S5:23, S5:13 | high |
| A8.3 | Consumer Terms: "We may use Materials to provide, maintain, and improve the Services ... including training our models, unless you opt out of training through your account settings." Exceptions even when opted out: Feedback and safety-flagged Materials. | S4:41 | high (truncated line; exceptions as quoted) |
| A8.4 | Org rules: "ZUS local-first: không đẩy data user lên server"; "Dữ liệu client/CRM là bảo mật: tách biệt từng client, thu tối thiểu, anonymize ví dụ"; VN law: "Nghị định 13/2023/NĐ-CP, Luật Bảo vệ dữ liệu cá nhân 2025 — đối chiếu bản gốc trên vbpl.vn / chinhphu.vn". | S7 (section 3, ~lines 51-58) | high for 8 Sync rule; VN-law clause text not verified here |
| A8.5 | Kit memory today lives in repo files (`su-code/STATE.md`, KNOWLEDGE.md) and a `SessionStart` digest, not in a separate store. | S21 ccc.rs:769 session_digest; S23 | high |
| A8.6 | Team-mode files: task list "persists locally and is never uploaded"; team config under `~/.claude/teams/`. | S11 "Architecture" | high |

Verdict: CONDITIONS. Allowed to store; contents sent to Claude are governed by the plan's terms (A8.2 vs A8.3: Team/API = Commercial, no training; Free/Pro/Max = opt-out setting). Rules for 8 Sync: per-client separation, minimum data, no client or CRM data in shared memory, local-first for ZUS (A8.4). A memory that profiles individuals without awareness hits S1:59. VN data law requirement not verified in this pass (no vbpl.vn fetch).

## A9. Routing Claude Code to other models through an LLM gateway

| # | Claim | Source | Confidence |
|---|---|---|---|
| A9.1 | "Anthropic doesn't endorse, maintain, or audit third-party gateway products, and doesn't support routing Claude Code to non-Claude models through any gateway." | S17 | high |
| A9.2 | "Any gateway that exposes a supported API format works." While a gateway credential variable or `apiKeyHelper` is active, "the subscription's usage limits don't apply to them" and traffic "is billed per token to whoever owns the credential the gateway forwards". Setting only `ANTHROPIC_BASE_URL` "doesn't replace the subscription ... a saved claude.ai login remains the active credential". | S17 "Subscriptions and gateways" | high |
| A9.3 | HIPAA: "Claude Code routed through a third-party cloud provider or a gateway aren't covered." | S6 | high |
| A9.4 | AUP after 11-12: "Resell, proxy, or otherwise provide access to Claude through unauthorized means, including services that route requests through consumer subscriptions or misrepresent the product or client being used". | S1:134 | high |
| A9.5 | Repo: `8sync harness claude-code` with a non-Anthropic endpoint "configures Claude Code only"; Forge/omp take Console keys only; 9router `cc/` proxy removed. | S22 (README "Claude, the official way"); S23 STATE v0.66.0 | high |

Verdict: ALLOWED: own gateway in front of the Console key or Bedrock/Vertex/Foundry for Claude models, own org (S17). NOT ALLOWED: any gateway or proxy that forwards a subscription (OAuth) login to serve others or other tools (S6, S1:134). Non-Claude models through a gateway: no clause forbids it, but Anthropic "doesn't support" it (A9.1), so not a supported path; the kit's guard already denies wiring Claude Code's OAuth client id or beta header into other software (S21 guard.rs:8-9, :111).

## A10. Borrowing code from MIT / Apache projects

| # | Claim | Source | Confidence |
|---|---|---|---|
| A10.1 | Existing practice: Feynman (MIT) files adapted with attribution; "Upstream license text" and copyright "(c) 2026 Companion, Inc." reproduced in THIRD_PARTY_NOTICES.md; source commit 4cec627. | S19 | high |
| A10.2 | MIT condition reproduced in S19: "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software." | S19 | high |
| A10.3 | STATE v0.66.0 for CowAgent (MIT): "borrow ideas, not a base"; research from "local clones only, no decompiling". Size ceiling raised "with per-commit attribution". | S23 STATE (v0.66.0 checklist) | high |
| A10.4 | Anthropic side: Claude Code repo LICENSE.md is one line: "© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service." So Claude Code source and bundled plugins in anthropics/* are NOT MIT/Apache by that file. Per-plugin licences under `claude-plugins-official` not checked. | S18 | high for LICENSE.md; plugin licences not verified |
| A10.5 | Apache-2.0 terms (NOTICE file, state changes) are not in the repo notices; no Apache project is listed in THIRD_PARTY_NOTICES.md (head 40 lines only read). | S19 | medium |

Verdict: ALLOWED with CONDITIONS: MIT: keep copyright + licence text (A10.2); Apache-2.0: preserve NOTICE, state modifications, licence copy (not in repo notices today, A10.5; general licence knowledge, no source fetched). NOT ALLOWED to copy code from Anthropic's Claude Code repo (A10.4, all rights reserved); ideas only.

## A11. Reading or copying Claude Code's system prompt

| # | Claim | Source | Confidence |
|---|---|---|---|
| A11.1 | Consumer Terms: "To decompile, reverse engineer, disassemble, or otherwise reduce our Services to human-readable form, except when these restrictions are prohibited by applicable law." | S4:24 | high |
| A11.2 | Commercial Terms D.4: "(b) reverse engineer or duplicate the Services". | S5:20 | high |
| A11.3 | Commercial/Consumer: no clause found that names "system prompt" or "prompt extraction" explicitly. | S4, S5 (grep) | high that no clause was found by grep; absence is not permission |
| A11.4 | Anthropic documents what it sends in public docs (e.g. `--append-system-prompt`, `--system-prompt` replace default; "system reminders" listed in glossary; gateway protocol page "what Claude Code sends to a gateway"). | S9, S17 | high |
| A11.5 | Binary-level: S6 says "The Claude Code binary must not be modified." (for products embedding it). Repo LICENSE is all rights reserved (S18). | S6, S18 | high |
| A11.6 | 8 Sync rule: "Không proxy/giả client, không reverse-engineer hay sao chép prompt Claude Code." | assets/claude/CLAUDE.md:4; user ~/.claude/CLAUDE.md | high (internal rule; stricter than the clauses) |
| A11.7 | Branding: "Your product should maintain its own branding and not appear to be Claude Code or any Anthropic product." | S8 | high |

Verdict: reading prompts Anthropic publishes in docs: ALLOWED. Decompiling the binary or extracting and copying the system prompt text into 8 Sync products: NOT ALLOWED by the 8 Sync rule (A11.6), and plausibly by "reverse engineer or duplicate" (A11.1, A11.2). Writing your own prompts inspired by documented behaviour: ALLOWED. Earlier research already followed "local clones only, no decompiling" (S23).

---

# Part B — current ccc inventory (what exists) and known gaps

## B1. What ccc already does

| # | Fact | Source (file:line) | Confidence |
|---|---|---|---|
| B1.1 | `apply_kit_settings` merges (never replaces) `~/.claude/settings.json`: env `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`; `effortLevel: medium`; `disableClaudeAiConnectors: true`; `permissions.defaultMode: auto`; DENY and ALLOW lists; `skillOverrides` name-only for non-core skills; hooks. Only missing keys are added (user values win). | ccc.rs:553-583 | high |
| B1.2 | DENY (16 rules): Read/Edit of `**/.env`, `.env.*`, `*.pem`, `*.session`, `*.pkl`; Read of `id_rsa*`, `id_ed25519*`; Bash `git push --force*`, `-f*` variants. | ccc.rs:336-353 | high |
| B1.3 | ALLOW (15 rules): `cargo check/build/test/clippy/fmt/nextest`, `go build/test/vet`, `npx tsc`, `npm/pnpm/bun test`, `pnpm typecheck`, `git add*`. Commits, pushes, discards stay reviewed. | ccc.rs:363-379 | high |
| B1.4 | Hooks installed: SessionStart (`session-start` digest of STATE.md + lessons), PostToolUse Edit/Write/MultiEdit `verify` (async, `asyncRewake`, timeout 600), Stop `verify-stop` (timeout 600; includes native Stop gate), PreToolUse `AskUserQuestion` prompt hook (Sonnet 5.5, `continueOnBlock`, 30 s), PreToolUse guard on `Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit`, HQ events `TaskCreated TaskCompleted TeammateIdle Notification` (async, `8sync hq hook`). Retired: Haiku Stop prompt gate. | ccc.rs:585-667, 336-380 (RETIRED_HOOKS ~line 400), 681 | high |
| B1.5 | Guard denies: credential-file writes, real-looking secrets in code/commands (Anthropic, OpenAI, GitHub, AWS, Slack, Google, private keys), `git add` of credential files incl. `-A`, code wiring a Claude subscription into other software (Claude Code OAuth client id / OAuth beta header), destructive shell (root/home/project deletes, disk wipes, force-push, printing/uploading `.env`). Asks on riskier deletes, run-time targets, `git reset --hard`, `git clean -f`, etc. Panic hook converts internal error to `ask`. | guard.rs:1-17, :102-115; danger.rs:1-35; ccc.rs:1055-1062 | high |
| B1.6 | Native Stop gate (`gate.rs`): blocks a turn that ends on an announced-but-undone plan or a routine permission question; always lets the turn end on `stop_hook_active`, a running background task, a user "stop"/"dung", RISKY topics (secret, deploy, publish, push, delete, customer, email, send...). Uses word lists, no model call. | gate.rs:1-23, :27-66, :107-112 | high |
| B1.7 | Verify: after every edit runs `cargo check`, package `typecheck`/`tsc --noEmit`, or `go vet` from the nearest manifest, in the background; `verify-stop` waits and blocks the stop while the build is broken (once per broken state). | verify.rs:1-13; README:~121 | high |
| B1.8 | Org policy generator `8sync ccc policy [--org-uuid] [--out] [--strict-hooks] [--lock-mcp]`: `disableBypassPermissionsMode: "disable"`, DENY list, `forceLoginMethod: "claudeai"`, `strictKnownMarketplaces` (anthropics/claude-plugins-official, 8-Sync-Dev/su-code), sandbox enabled + denyRead `~/.ssh ~/.aws ~/.gnupg`, `channelsEnabled: true`; optional MCP lock to codebase-memory-mcp + serena; optional managed hooks with `allowManagedHooksOnly`. Never writes system paths. | ccc.rs:842-975 | high |
| B1.9 | `assets/claude/`: 10 agents (architect, designer, explore, pm, qa, quick-task, researcher, reviewer, task, verifier), 4 skills (harden, rules, sec, ship), and a CLAUDE.md block with the org rules (subscription only in official Claude Code, no proxy, no reverse engineering or copying prompts, no secrets, ZUS local-first, client data separation, high-risk needs human review + AI disclosure, autonomy rule, "not verified" rule). | assets/claude/ listing; assets/claude/CLAUDE.md:1-20 | high |
| B1.10 | Repo-side compliance: `/aup-audit`, weekly `legal-sync` snapshot of Anthropic texts into docs/legal/anthropic/, internal rules doc, README "Claude, the official way" (no login bridging, no proxying a consumer subscription). | S22:206-226; S7 | high |
| B1.11 | Agent HQ (Discord) rides Anthropic's official Channels plugin; HQ itself "never sees a Claude credential"; charter says every persona is an AI; allowlist only owner; docs say a 24/7 fleet on one subscription is not "ordinary, individual usage" (seat rule not verified). | docs/hq.md:9-10, 20, 22, 35, 37 | high |
| B1.12 | Public marketplace: `/plugin marketplace add 8-Sync-Dev/su-code`, `8sync-kit@8sync` (subagents + /ship only; hooks, rules, skills come from `8sync ccc kit`). | README:105-110 | high |
| B1.13 | Measured numbers in repo (not re-verified here): 249 tests (STATE Unreleased); ask gate Sonnet 6/6, Haiku 4/6; startup and token measurements per README bench tables. | S23; README:~137-146 | medium (read, not rerun) |

## B2. Known gaps and open items (from sources)

| # | Gap / open item | Source | Confidence |
|---|---|---|---|
| B2.1 | Guard is "a seat belt, not a sandbox": a program that deletes files itself (`python -c`, a build script) is not inspected; Claude Code sandbox does not run on native Windows. | README:~122-125 (Limits) | high |
| B2.2 | Under `claude -p` an "ask" is a denial, so run-time-target deletes (`rm -rf "$OUT"`) are refused there; spell out the path. | README Limits; hooks docs via STATE:8-9 | high |
| B2.3 | `AskUserQuestion` does not exist in `claude -p`, so the ask gate only works in interactive sessions; hard-coded model id `claude-sonnet-5-5`; "If its model id is ever retired, the hook fails open"; ask-gate evidence measured on Sonnet 5 vs Haiku 4.5, "not re-measured on 5.5". | README Limits; ccc.rs:~402-405 | high |
| B2.4 | Stop gate judges only the last message (+ user's last), forces at most one continuation per stop; word lists (English + Vietnamese); any doubt ends the turn. Claude Code separately caps consecutive stop-hook continuations at 8. | README Limits; gate.rs:1-23; S13 | high |
| B2.5 | Outward actions: guard denies force-push only. Grep of danger.rs/guard.rs shows no rule for plain `git push`, `gh pr merge`, deploys (Encore, Vercel), `npm/cargo publish`, webhook/`curl` posts or messaging. In `auto` mode such commands depend on the Claude Code classifier; ALLOW does not list them, so they are classifier-reviewed. The Stop gate's RISKY list only stops it from forcing continuation. | grep result on danger.rs, guard.rs (only hits: tests for `git push --force`/`gh pr create` pass-case); ccc.rs:363-379; gate.rs:107-112 | high that no rule exists; whether the classifier blocks them is not verified |
| B2.2b | `/goal` and `/loop` are not wired into the kit (no mention in ccc.rs), no `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` setting; unattended `claude -p` runs get no `--max-budget-usd`/`--permission-prompts none` defaults from the kit. | grep ccc.rs (0 hits for goal) | medium (grep only on ccc.rs, not whole crate) |
| B2.6 | The kit does not set `--bare`-style guidance for CI/headless; headless `-p` still loads project hooks and MCP "even in a folder you've never trusted" unless `--bare`. | S9; README:94 (`-p` passes flags through) | medium |
| B2.7 | Not verified in prior releases: real Discord, agent-team mode (interactive session needed), Channels plugin under a Team org with `channelsEnabled`. | S23 STATE v0.66.0 "Current" | high |
| B2.8 | Open owner items: push + release v0.67.0 (Unreleased is committed locally, not pushed); ccc vs omp bench with a Console key for cost; re-inject the compact CLAUDE.md block in ~/startup; size: linux asset 19.5 KiB under ceiling at v0.66.0 ("next feature needs attribution or trimming"; v0.67 ceiling now 5760 KiB per Unreleased note). | S23 STATE:31-32 and v0.66.0 Next; Unreleased checklist | high |
| B2.9 | Hooks/policy not verified: `allowedMcpServers` `serverName` match for plugin-scoped MCP names is "not verified" (policy note); `allowManagedHooksOnly` only with `--strict-hooks` and double-run risk; `forceLoginMethod` refuses to start while an API key/token/apiKeyHelper is configured. | ccc.rs:912-972 (notes) | high |
| B2.10 | Disclosure and consent for HQ personas rely on a pinned charter; no code-level AI-disclosure enforcement for any outward messages the agents send. | docs/hq.md:20, 37 | medium |
| B2.11 | Memory: no dedicated memory store; repo files only. No per-client separation mechanism in the kit beyond rules text. | ccc.rs:769; assets/claude/CLAUDE.md:7 | medium |
| B2.12 | Apache-2.0 attribution mechanism absent (only MIT Feynman listed in first 40 lines of THIRD_PARTY_NOTICES.md). | S19 | medium |
| B2.13 | `docs/legal` snapshot lags: `legal-sync` snapshot committed 2026-10-12 includes the Nov 12 AUP, but S7's rules text predates a documented diff between the two AUP versions; no note in S7 that the Nov 12 version is future-dated. | S7:4; S1:4; git log docs/legal/anthropic | medium |

---

# Contradictions between sources

1. S10 (help article, 2026-10-07): "You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits." vs S6/S8: Anthropic "does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users" and S1:134 "services that route requests through consumer subscriptions". Possible reconciliation (not stated by Anthropic): S10 describes a user's own use of a third-party app, S6 forbids developers offering it to their users. Not verified; treat S6/S1 as binding and S10 as billing information.
2. S4 (Consumer Terms s.3) bans automation "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it" vs S9/S10 documenting `claude -p` on subscription. Resolves only through the "explicitly permit" clause (S10 / Claude Code docs). No Terms amendment found.
3. AUP versioning: S2 says effective 2026-11-12 (future) while the Terms and Claude Code legal page already reference the AUP generically (S6 "subject to the Anthropic Usage Policy"). Which AUP text applies on 2026-10-13 is not stated by Anthropic. S7 cites the proxy rule under "Do Not Abuse Our Platform", which only the new text contains (S3 vs S1).
4. S12 says Channels need "Anthropic authentication through claude.ai or a Console API key" while the 8 Sync policy generator forces `forceLoginMethod: "claudeai"` (ccc.rs:870-873); a Console-key-only org would hit the `forceLoginMethod` startup refusal noted at ccc.rs:963-964. Not a source conflict, a config conflict to be aware of.
5. S24 secondary blogs (tygartmedia "last verified October 5, 2026") say the June 15 credit split is live; S10 says it was paused and, on 10-07, adds Max/Team monthly API credits. S10 is primary.

# Not found / not verified

- Exact definition or numeric limit of "ordinary, individual usage" for Pro/Max (S6). Not found.
- Any Anthropic statement on how many parallel sessions per subscription are acceptable. Not found.
- Software Directory Policy text (needed for directory submission). Not fetched.
- Full body of S10 beyond update notes; "Monthly API credits for Max and Team plans" article (not read).
- Hooks doc last 68k characters (agent-hook details beyond the handler table) not read.
- Whether the Nov 12 2026 AUP is enforced before its effective date. Not stated.
- AUP "Previous Version" bullets truncated at 125 chars by the fetch tool; full prior text not read.
- VN law texts (ND 13/2023/ND-CP; 2025 Personal Data Protection Law): not fetched this pass; cite vbpl.vn / chinhphu.vn before using in advice.
- Apache-2.0 obligations: general licence knowledge, no source fetched this pass.
- Per-plugin licences inside anthropics/claude-plugins-official: not checked.
- `docs/legal/anthropic/claude-code-data-usage.md` and privacy-policy.md not read this pass (relevant to A8 for retention/training defaults).
- Whether Claude Code's auto-mode classifier blocks non-force `git push`/deploy/publish: not tested.
