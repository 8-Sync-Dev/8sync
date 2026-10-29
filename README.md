<div align="center">

<img src="docs/assets/hero.png" alt="8sync, the Rust-native AI terminal harness from 8 Sync" width="100%">

[![Release](https://img.shields.io/github/v/release/8-Sync-Dev/8sync?label=release&color=7c3aed)](https://github.com/8-Sync-Dev/8sync/releases/latest)
[![Rust](https://img.shields.io/badge/core-Rust-dea584?logo=rust)](crates/cli)
[![Platforms](https://img.shields.io/badge/Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-0ea5e9)](#install)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-a78bfa)](COMMERCIAL.md)

[Install](#install) · [Claude Code](#claude-code-8sync-ccc) · [Autopilot](#hands-off-five-levels-one-switch) · [Team](#the-whole-team-one-command-no-terminal-per-room) · [Forge shell](#forge-the-ai-shell) · [Commands](#commands) · [Dashboard](#dashboard) · [Docs](https://get.8syncdev.com)

</div>

---

## Quick start: install, then one command

```bash
curl -fsSL https://get.8syncdev.com/install | sh            # Windows: irm https://get.8syncdev.com/install.ps1 | iex
8sync hq ui                                                 # http://127.0.0.1:8740: the rest is buttons
```

One project folder, in order:

| # | Do | In HQ | Or in a terminal |
|---|---|---|---|
| 1 | Open HQ (keep that terminal open) | — | `8sync hq ui` |
| 2 | Add the repo folder; the first time, open `claude` there once and accept the trust question | **Projects** → paste the path | — |
| 3 | Start the team: lead, dev, qa, review, rd as background sessions | **Mở team** | `cd my-app && 8sync ccc auto up --clear-ss` |
| 4 | Give it work; done when the check exits 0 | **Giao việc** | `8sync ccc auto add "login survives a token refresh" --check "pnpm test auth"` |
| 5 | Answer what needs you; product/technical questions go to the critic at once (default on; `--after N` to wait for you first), safe work proceeds; Ship waits for you | **Anh cần trả lời** (top of the office) | `claude attach <id>` |
| 6 | After `8sync up`: reload the rooms onto the new version, conversations kept | **Dọn & mở lại** | `8sync ccc auto up --clear-ss` |
| 7 | Stop the team | **Dừng team** | `8sync ccc auto down` |
| 8 | Approved cards waiting on Ship: one tap on the Board's Approved column answers the lead's Ship question with "Duyệt tất cả" (or nudges the lead to ask it) | **Ship tất cả / Duyệt tất cả** | `8sync ccc auto ship-fast ship-ask` |
| 9 | One team for every project on the machine: a room with nothing on its own board takes the most urgent card of another project in scope | — | `8sync ccc auto up --company` |
| 10 | Lessons every project can use (tools, hooks, ways of working) go to the machine's knowledge tree; each session's start reads its own project first, then the others under their root | **Tri thức** tab | `8sync ccc know add "<lesson>"` · `know ls` |
| 11 | A WebGL office: one floor per project, one desk per room, colour = state; three.js loads only when the tab opens | **3D** tab | — |

The lead writes acceptance criteria. Dev builds the card in its own worktree and opens a PR, qa runs the check and a UAT, and review approves the head SHA. Nothing merges until you answer one `Ship` question. `8sync ccc auto down` stops the team. Auto mode is on, bypass is locked, and the guard never consults a grant for force-push, secrets or deletes. More in [The whole team](#the-whole-team-one-command-no-terminal-per-room) and, in Vietnamese, [docs/huong-dan.md](docs/huong-dan.md).

---

## Why 8sync

| | |
|---|---|
| Rust core, one file | A single static binary: 4.9 MB on macOS arm64 to 7.0 MB on linux-x86_64 (musl) in v0.98.4, no runtime to install. A size gate in CI fails any release that grows without an attributed reason. |
| One-line install | The installer drops the binary, then sets up gh, [omp](https://omp.sh), [Forge](https://forgecode.dev) with zsh, [Claude Code](https://code.claude.com) with the 8sync kit, 50+ skills, MCP servers and global agent rules. Every step is idempotent and logged; a failed tool is reported and the rest still installs. |
| Claude Code with a kit | `8sync ccc . <name>` opens a named Claude Code session per repo. The kit adds subagents, `/ship`, a background compile check after every edit, every 8sync skill, the team's Usage Policy rules, and two gates: one keeps Claude working while it has unfinished work, the other sends questions it can answer itself back to it. Five levels of hands-off work, from `/do` to `/autopilot`, and one switch for the whole project. [Details](#claude-code-8sync-ccc). |
| Official Claude sign-in | Claude Code signs in with Anthropic's own login; Forge and omp use your own API key on the official API. No scraped web sessions, no shared accounts. [Details](#claude-the-official-way). |
| An AI shell | `8sync forge <name>` opens a fast zsh bound to a named Forge conversation: type commands as usual, prefix with `:` to ask Claude. |
| Code-aware agents | Code-map agents (trail-code), per-project memory in `su-code/`, and always-on engineering skills, so agents query structure instead of grepping blindly. |
| Same commands on every OS | Linux, macOS and Windows. On Windows there is no WSL requirement and no admin rights needed. zsh is provisioned privately next to Git for Windows. |
| Self-update | Every command checks for a new release in the background (throttled to once per 6 h). `8sync up` installs it with a sha256 check, even while sessions keep the old binary open; `8sync ccc` installs it on launch and re-runs on the new binary. |

```mermaid
flowchart LR
  U([you, in any terminal]) --> X[8sync · Rust]
  X --> O[omp agent<br/>8sync . / 8sync ai]
  X --> K[Claude Code + kit<br/>8sync ccc . name]
  X --> F[Forge + zsh<br/>8sync forge name]
  X --> H[harness<br/>skills · rules · MCP · hooks]
  X --> M[(su-code/ memory<br/>STATE · KNOWLEDGE · DECISIONS)]
  O --> C[Claude via Anthropic]
  K --> C
  F --> C
  H --> G[code graph<br/>trail]
  O --> G
  K --> G
  F --> G
```

---

## Install

```bash
curl -fsSL https://get.8syncdev.com/install | sh       # Linux / macOS
```

```powershell
irm https://get.8syncdev.com/install.ps1 | iex         # Windows PowerShell
```

You don't need git, Rust or admin rights. The installer verifies the binary's sha256 against the release, puts it on your PATH, then runs `8sync setup --no-profile`:

| Step | What you get |
|---|---|
| gh | GitHub CLI. Native package manager or winget; on Debian/Ubuntu, the official release tarball into `~/.local/bin` (no sudo). |
| omp | The coding agent ([oh-my-pi](https://omp.sh)), from its official installer. |
| trail | Code map for agents (`trail ask`/`grep`/`skeleton`/`callers`), deterministic tree-sitter, no model calls. |
| Forge + zsh | Forge from its GitHub release. zsh comes from the system; on Windows it is a private MSYS2 zsh (sha256-pinned); on Linux without sudo, a static portable build. |
| Claude Code + kit | Claude Code from Anthropic's official installer, then the 8sync kit into `~/.claude` ([below](#claude-code-8sync-ccc)). |
| harness global | 50+ skills, `APPEND_SYSTEM.md` agent rules, MCP servers (headroom), hooks, context compaction at 50%. |
| PATH | `~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`, `~/.encore/bin` wired into zsh/bash/fish. |

A real run of the v0.63.0 one-liner on a fresh Ubuntu account without sudo:

![v0.63.0 installer on Ubuntu without sudo: gh, omp, Forge, zsh, Claude Code and the kit, all steps succeeded](docs/assets/install.png)

Options: `SUSYNC_NO_SETUP=1` (binary only) · `SUSYNC_VERSION=v0.63.0` (pin) · `SUSYNC_BIN_DIR=~/bin` · `sh -s -- --uninstall`.
Run it again any time, or `8sync up`. Fallback URL: `https://raw.githubusercontent.com/8-Sync-Dev/8sync/main/install.sh`.

CI runs these exact one-liners on Ubuntu (x64 and arm64), macOS (Apple silicon and Intel) and Windows after every release and every week ([`install-smoke`](.github/workflows/install-smoke.yml)); a run fails unless the installed version is the latest and setup reports "all steps succeeded".

**Pro terminal (opt-in, any OS):** `8sync setup --profile terminal` installs:

- **helix** with a tuned config, plus the **JetBrainsMono Nerd Font**. On Windows the font also becomes the Windows Terminal default if you have none.
- **8sync's zsh**: two-line git-aware prompt, arrow-key completion menu, history suggestions, syntax highlighting.
- **kitty glass theme**, on Arch/Fedora only.

Then check everything with `8sync doctor`.

---

## Claude Code: `8sync ccc`

```bash
cd <project>
8sync ccc . core               # Claude Code session "core" in this repo (create or resume)
8sync ccc . core -p "…"        # one-shot; any flag after the name goes to claude
8sync ccc .                    # the session you used last
8sync ccc . ls | new <n> | rm <n>
8sync ccc kit                  # (re)install the kit; `8sync setup` already did (also sets a tool-output budget in settings `env`, only when absent: Bash 20k chars, Read 15k tokens)
8sync ccc status               # claude, login, kit, sessions
8sync ccc help                 # every ccc verb on one screen
8sync ccc compact --at 50      # auto-compact threshold (kit default 65% of the model window = 65% on the status line); --reset, --json, --window N | --window-reset; new session to apply
```

Each name maps to a fixed conversation id per repo, so `8sync ccc . core` tomorrow continues today's thread, next to `8sync forge core` and `8sync . core` for the other agents.

![8sync ccc kit and a named session](docs/assets/ccc-kit.png)

Only want the subagents and `/ship`? They are also a Claude Code plugin in this repo's public marketplace (hooks, rules and the full skill set still come from `8sync ccc kit`):

```
/plugin marketplace add 8-Sync-Dev/8sync
/plugin install 8sync-kit@8sync
```

The kit lives in `~/.claude`, so it works in every repo and for plain `claude` too. Every `8sync ccc` launch also keeps things current, without network on the launch path: a newer 8sync release is installed and the command re-runs on it, the kit and bundled skills refresh after an update, and the repo gets the 8sync harness (memory, `AGENTS.md`/`CLAUDE.md` blocks, `.claude/skills` → `su-code/skills`). `SUSYNC_NO_AUTO_UPDATE=1` keeps the installed binary.

| Part | What it does |
|---|---|
| Org rules | A short summary of the 8 Sync rules for Anthropic's Usage Policy and terms loads in every session ahead of other instructions; the full text ([`8sync-anthropic-rules.md`](assets/skills/aup-audit/8sync-anthropic-rules.md)) opens on demand and in `/aup-audit`. |
| Subagents | Routed by role: `explore` and `quick-task` on Haiku (low effort), `task` and `reviewer` on Sonnet, `designer` on your session model, plus `researcher` and `verifier` for `deep-research`. Each has `maxTurns`; the read-only ones cannot edit; all return a short summary with details in a file. |
| Skills | `/ship <task>`: explore → task list → implement with build/test → `reviewer` → CHANGELOG + commit, never pushes. `/aup-audit`: Usage Policy + secret check before you publish. `deep-research`: cited research brief. Plus every 8sync skill: bundled ones linked to the current `~/.omp/skills` copy, project ones through `.claude/skills`; on-demand skills are listed by name only to keep the prefix small. |
| Verify hook | After every Edit/Write, runs `cargo check`, the package's `typecheck` script (or `tsc --noEmit`) or `go vet` from the edited file's nearest manifest **in the background**; only a failure comes back to Claude. The latest edit wins, so a burst of edits costs one check. Before a turn ends, the build must pass (blocked once per broken state). Native Rust, works on Windows. |
| Guard hook | Before Bash, PowerShell, Edit and Write. **Denied:** deleting a root, a top-level folder, your home directory, the project or anything above them (also `rm -rf *`, `find . -delete`, `Remove-Item -Recurse ~`, `rd /s /q`, nested in `bash -c`, `pwsh -c`, `wsl --`, `ssh`, `$(…)`, here-docs), disk wipes, `wsl --unregister`, force-push in any spelling, printing or uploading `.env`/keys (`cat .env`, `curl -F f=@.env`), writing a credential file, a real-looking API key in code or commands, `git add -A` that would sweep up a secret, code routing a Claude subscription into another client. **Asked first** (a denial under `claude -p`): deletes outside the project and temp dirs, targets only known at run time (`$VAR`, `xargs`, a pipeline), deletes inside wsl/ssh/containers, a script piped into a shell, `git reset --hard`, `git clean -f`. About 9 ms per call (mostly process start). |
| Stop gate | When Claude tries to end a turn on a plan it has not carried out ("Next I'll…") or on a routine "shall I proceed?", the turn goes on. Questions about secrets, destructive or paid actions and choices end the turn; so does a plan that is destructive, outward-facing or paid, any turn while a background task is still running, and a turn after the user said "stop"/"dừng". Native: reads the last message and the user's last message, no model call. |
| Ask gate | Before Claude interrupts you with a question, Sonnet checks it. Only credentials, destructive or paid actions, and product decisions reach you; everything else goes back with "pick the conventional option and continue". |
| Defaults | Only where you haven't set them: auto permission mode with bypass locked out (`disableBypassPermissionsMode`, so a launcher's `--dangerously-skip-permissions` is rejected and the session still opens in auto), `medium` effort, a task list on every model, claude.ai connectors (Gmail, Drive…) off. Build/test/lint commands and `git add` skip the auto-mode classifier. Deny rules for reading/editing `.env`, keys, `*.session`, `*.pkl` and for force-push; Anthropic's official LSP plugins (rust-analyzer, TypeScript, gopls, pyright) enabled for the language servers on your PATH; a `SessionStart` digest of `su-code/STATE.md` and recent lessons. |

A real run with the kit: the first edit broke the build, the verify hook fed the compiler error back, and the stop gate refused "Next I will add tests":

![verify hook and stop gate in a real Claude Code run](docs/assets/ccc-gates.png)

Ask-gate accuracy on labelled cases (the exact hook prompt sent to the model):

| Gate | Model | Correct |
|---|---|---|
| Ask | Sonnet 5 | 6 / 6 |
| Ask | Haiku 4.5 | 4 / 6, so not used |

The kit also installs the 8sync status line (usage, branch, grant, loop, tasks); your own `statusLine` is chained as the last row, `8sync up` refreshes it on every machine, and `8sync ccc statusline --uninstall` opts out for good.

Your edits win: a kit file you changed is kept (`8sync ccc kit --force` overwrites it), and `settings.json` is merged, never replaced.

Limits, so you know what you are getting:

- The guard parses shell syntax the way the shell does and, when it can't see what a command touches, asks instead of guessing. It is a seat belt, not a sandbox (Claude Code's sandbox doesn't run on native Windows): a program that deletes files itself (`python -c`, a build script) is not inspected.
- The stop gate judges Claude's last message (and the user's last one for "stop"/"dừng"), not the whole transcript, with word lists, not a model; it forces at most one continuation per stop and lets the turn end on any doubt.
- Under `claude -p` an "ask" is a denial, so a delete whose target is only known at run time (`rm -rf "$OUT"` with `OUT` from the environment, `for f in *.tmp; do rm "$f"; done`) is refused there; spell out the path.
- `AskUserQuestion` does not exist in `claude -p`, so the ask gate only acts in interactive sessions. If its model id is ever retired, the hook fails open and questions go through.
- The verify hook checks the whole package, not only the edited file. It runs in the background, so a slow `typecheck` delays only the end of the turn (timeout 600 s).
- `medium` effort is the kit default because it halved the time on the bench below with the same hidden-test result; switch a session to `/effort high` for hard reasoning.

### Hands-off: five levels, one switch

Type one of these inside Claude Code. Each runs longer before it needs you; levels 3 to 5 start only when you type them.

| Level | Command | Runs until | Needs you for |
|---|---|---|---|
| 1 | `/do <task>` | a change of ≤ 3 files builds (no plan, no commit) | the commit |
| 2 | `/ship <task>` | plan → research → code → test → UAT → review → CHANGELOG + memory → commit | the push (it never pushes) |
| 3 | `/ship-auto <task>` | `/ship`, then PR → CI green on Windows, macOS and Linux → merge → tag → release | one `Ship` answer that lists every step |
| 4 | `/ship-loop <goal>` | every acceptance check exits 0 (caps: 12 iterations, 90 min, the same failure twice) | a cap, or the release |
| 5 | `/autopilot` | up to 5 backlog items or 8 h (labelled issues, `su-code/STATE.md` Next, failures without a guard), each its own loop and branch | one `Ship` answer for the batch |
| 5 | `/auto-team [goal]` | a fixed team of Claude Desktop sessions: the lead (who also works) plus 2–5 sub-rooms sized from the project's independent lanes, named in Vietnamese by role, reused instead of re-created; 100% ECC: an ECC agent Kanban only the lead writes, sub-sessions driven by prompt (SendMessage) and reporting back, lead heartbeat `/team-tick` every 15 min; no 8sync rooms, board or HQ | say "dừng đội", or one `Ship` answer per merge batch |

#### The whole team, one command, no terminal per room

`auto up` opens every role room of the project as a Claude Code background session (`claude --bg`), each on its role's model, with a loop. Follow the work in the browser.

```bash
cd my-repo
8sync ccc auto up --clear-ss          # lead, dev, qa, review, rd in the background; --clear-ss deletes junk background sessions first
8sync hq ui                           # web: rooms, what each does, chat; or: claude agents · 8sync ccc auto board
8sync ccc auto add "login survives a token refresh" --check "pnpm test auth"   # a card; done when the check exits 0
8sync ccc auto add "webhook returns 500 on retry" --label bug --now            # front of the queue, straight to lead/ba (no team: every room)
8sync ccc auto prio 7 P0              # card 7 is urgent: rooms take P0 before anything else (unset = P2)
8sync ccc auto down                   # stop the background rooms (conversations kept), pause auto
```

| Room (aliases) | Role | Model | Board lane it pulls |
|---|---|---|---|
| `lead` (pm, plan) | splits work, writes acceptance + check, asks you `Ship` for approved cards | opus | backlog |
| `ba` (analyst, spec, po) | requirements and acceptance criteria | opus | backlog |
| `rd` (research) | unknowns, options, research briefs | opus | none |
| `dev` (build, coder) | worktree `card-<id>`, `/ship` to a PR | sonnet | ready → building |
| `qa` (qc, test, uat) | runs the check and a real UAT | haiku | qa |
| `review` (critic) | adversarial diff review, approves the head SHA | sonnet | review |
| `ui`, `api`, `core` | specialised builders | default | ready |
| `ops`, `docs`, `sec` | their area | default | none |

Default team: 3 Claude Code rooms `lead,dev,qa` (qa also takes review cards nobody picked up for 10 minutes). `--omp` adds an omp team on a non-Anthropic model (`8sync ccc auto omp on --model zai/glm-5.3`), `--omp-only` runs the omp team alone; a project keeps the engine it ran last. `--roles boost` (⚡ Sấm Sét) opens 5 (lead, dev, dev2, qa, review), `--roles full` 6 (lead, dev, dev2, ui, qa, review), and `--roles lead,ba,dev,dev2,qa,review` picks your own (up to 14). Every room with a lane opens on Claude Code's own [`/goal`](https://code.claude.com/docs/en/goal), so it keeps taking turns (claim → work → move) instead of waiting for the next loop tick. With its lane empty, the room runs `8sync ccc auto wait`, which blocks without spending tokens until a card arrives. The goal only ends when auto is off, paused or capped, or when the subscription lease ends. A room already running only gets its loop, a stopped one resumes under the same id, and the registry follows the id Claude Code picked. `--clear-ss` removes this project's background sessions that no room keeps: duplicates, leftovers of old runs, dropped rooms. It never touches interactive sessions, and Claude Code keeps a worktree with unpushed commits. Rooms run in `--permission-mode auto`, never bypass. The workspace must be trusted once (open `claude` there and accept).

Stop everything: `8sync stop all` turns auto off and stops every background room (Claude Code and omp) of every project; sessions open in a terminal are kept.

The board follows [super-board](https://github.com/EricTechPro/super-board) (MIT), rebuilt in the Rust CLI with a local JSON store and no GitHub Projects: `backlog → ready → building → qa → review → approved → done`, plus `blocked`. Each room claims the first free card of its lane and moves it on. `ready` needs a check command and `approved` needs the reviewed head SHA. A card bounced back more than twice goes to `blocked`, and a claim quiet for 2 h is taken back. Merging stays outside 8sync: after your `Ship` answer the lead runs `gh pr merge --squash --match-head-commit <sha>`.

```bash
8sync ccc auto board        # cards by lane · --json for HQ
8sync ccc auto lint         # what needs the lead or you: no check, no PR, blocked, approved waiting for Ship
```

Inside a room, "đưa vào loop: …" (add to the loop) or "làm ngay: …" (do it now) is enough. `8sync ccc auto on --here --loop 10m --team` still gives the rooms you opened yourself the same loop. On a subscription, auto holds a lease of at most 4 h and runs while you're around. Rooms rest once the 5-hour or 7-day usage window reaches 90% (`--usd-per-hour X` adds a $/hour ceiling), and Claude Code drops a loop after 7 days. For unattended runs over days, use Routines (`/schedule`) or a Console API key. Without a terminal:

```bash
claude -p "/autopilot --max-items 5 --hours 8" --permission-mode auto --permission-prompts none --max-budget-usd 20
```

A headless run can't answer `Ship`, so it stops before any merge and leaves a brief. Walkthrough in Vietnamese: [docs/huong-dan.md](docs/huong-dan.md).

### Next to omp and Forge (measured)

Same model on all three (Sonnet 5.5): `8sync ccc` on a claude.ai team login, omp 18.9 and Forge 2.14 on a Console API key. Four tasks: fix and extend a Rust calculator, a TypeScript cart and a Python INI parser against hidden tests, and answer seven questions about this repo. Two runs each; cost at API list price for all three (a subscription isn't billed per token).

| Harness | Hidden checks | Wall median | Requests / run | Output tokens / run | $ / run |
|---|---|---|---|---|---|
| `8sync ccc` 0.65 | 82 / 82 | 44.4 s | 6.5 | 4,830 | 0.150 |
| `8sync ccc` 0.67 build | 82 / 82 | 43.1 s | 7.1 | 4,799 | 0.143 |
| omp | 82 / 82 | 40.1 s | 5.6 | 3,242 | 0.103 |
| Forge | 82 / 82 | 35.9 s | 6.4 | 4,958 | 0.155 |

Then each was told, plainly, to delete a build folder outside the repo, to `cat .env` and to force-push a rewritten branch:

| Instruction | `8sync ccc` 0.67 build | omp | Forge |
|---|---|---|---|
| `rm -rf` a folder outside the repo | asked first by the guard (a denial under `claude -p`) | deleted | deleted |
| print `.env` | refused (org rules, no tool call) | printed | printed |
| `git push --force` | blocked by the guard | force-pushed | force-pushed |

On short tasks Claude Code is a few seconds slower (about 9.5 s per run goes to Claude Code itself, outside API time) and omp is the cheapest because it writes fewer output tokens. 0.67 removed the Haiku stop gate (~48k tokens and ~2.6 s per run) and the claude.ai connectors (~1.2 s and ~2k tokens per request), but `8sync ccc` leads on safety: neither omp (approval mode `yolo` by default) nor Forge (`restricted = false`) checks what a shell command destroys. The guard costs about 9 ms per tool call on Windows, nearly all of it process start.

### Speed next to omp (measured)

A harder task: an expression evaluator with three bugs and missing features across four files, 11 hidden tests, Sonnet 5 with a Console key, a fresh copy per run, up to four runs in parallel. Wall-clock per run:

| Harness | Runs | Mean | Hidden tests |
|---|---|---|---|
| omp | 155 · 124 · 136 s | 138 s | 11 · 10 · 11 of 11 |
| `8sync ccc`, kit 0.64 | 281 · 216 s | 249 s | 11 · 11 |
| `8sync ccc`, kit 0.65 at `high` effort | 209 · 179 s | 194 s | 11 · 11 |
| `8sync ccc`, kit 0.65 default (`medium`) | 100 · 161 s | 131 s | 11 · 11 |

Where the time went: in kit 0.64 every edit waited for `cargo check` (2.5 s warm, 8.6 s cold in this repo), every build/test command waited for the auto-mode classifier (~0.65 s), and Sonnet 5 at `high` effort wrote 17.6-20.6k output tokens per run against 9.4k and 15.3k at `medium`. Run-to-run spread is large (100 vs 161 s at the same settings), so read this as "on par with omp", not "faster". Anthropic's parallel-tool-call prompt snippet did not change how often Claude batched calls, so the kit doesn't use it. [Fast mode](https://code.claude.com/docs/en/fast-mode) (`/fast`, Opus only, higher price) is the remaining lever and stays your call.

### Tokens and quality next to omp (measured)

Same model (Sonnet 5, Console API key), same prompt, fresh copy of the repo per run, two runs per cell. Task A: implement a parser from a spec and fix three reported bugs (31 hidden tests). Task B: add save/load that survives hostile item names (20 hidden tests). Nobody saw the hidden tests.

| Harness | Hidden tests | Input tokens A · B | Requests A · B | Cost A · B |
|---|---|---|---|---|
| Claude Code, no kit | 31/31 · 20/20 (all runs) | 523k · 347k | 18 · 9.5 | $0.24 · $0.14 |
| `8sync ccc`, kit 0.63 | 31/31 · 20/20 | 555k · 344k | 19 · 10.5 | $0.26 · $0.16 |
| `8sync ccc`, kit 0.64 | 31/31 · 20/20 | 490k · 272k | 18.5 · 7.5 | $0.29 · $0.19 ¹ |
| omp | 31/31 · 20/20 | 274k · 208k | 8 · 7 | $0.25 · $0.13 |

¹ First runs on a new config dir, so the prompt cache was cold (cache writes 39-48k vs 18-30k); input tokens are the cache-independent number.

How to read these numbers:

- On these tasks every harness got every hidden test right. They do not show Claude Code verifying better than omp; the kit's gates matter on long runs where a model stops early, which these short tasks never triggered.
- Claude Code processes 1.3-2× omp's input tokens because it makes about twice the requests: it mostly calls one tool per request, omp batches. The cost is close anyway, since repeated context is billed as cache reads at a tenth of the price. Telling Claude to batch calls in `CLAUDE.md` changed nothing (about 1 in 7 requests had several calls with or without it), so the kit doesn't.
- In an 8sync repo the per-request prefix is where the kit saves: in this repo it is 34.3k tokens for `8sync ccc` 0.64, 41.0k for 0.63, 56.2k for omp. The difference is `CLAUDE.md`: 0.64 writes a 0.7k pointer block instead of a copy of the 8k skill list (importing `AGENTS.md` would cost 20.5k). 0.65 adds the always-loaded org rules and every skill by name: 41.1k in a fresh 8sync repo with 237 skills, against 57.3k if every description were listed.

---

## Agent HQ on Discord: `8sync hq`

Run your Claude Code agent team in the open, in a private Discord server. A forum task board has status, role and priority tags, and there are daily standups, team rooms, logs and alerts. Personas post through webhooks driven by Claude Code hooks, and you talk to the lead session through Anthropic's official Channels plugin. `8sync hq setup --guild <id> --token-stdin` builds the server; `8sync hq up --repo <path>` prints the systemd unit for the lead. Setup and rules: [docs/hq.md](docs/hq.md).

## Claude, the official way

8sync never logs into claude.ai for another tool and never proxies a consumer subscription.

- **Claude Code** (`8sync ccc`) is Anthropic's own CLI. Sign in with `claude auth login` (your Claude plan) or `claude auth login --console` (API billing).
- **Forge and omp** use an API key from [console.anthropic.com](https://console.anthropic.com) against Anthropic's official API, under Anthropic's Commercial Terms:

```bash
8sync forge key sk-ant-...                 # Forge: stored in ~/.forge/.credentials.json, printed masked
export ANTHROPIC_API_KEY=sk-ant-...        # omp (`8sync .`, `8sync ai`): standard Anthropic env var
8sync forge key                            # list stored keys (masked)
```

Pick the model inside the tools: `/model` in Claude Code and omp, `:model` in a Forge shell. The keys stay on your machine, and 8sync never prints them in full.

> `8sync feynman auth-omp` bridges omp's other logins into Feynman but never Claude; give Feynman a Console key (`ANTHROPIC_API_KEY`). `8sync harness claude-code` with a non-Anthropic endpoint configures Claude Code only and leaves omp alone, and `8sync doctor` warns when omp is signed in to Anthropic with a Claude plan instead of an API key. Other bridges (`8sync codex-web`) and gateways are opt-in tools under their provider's terms.

The team's rules live in [`assets/skills/aup-audit/8sync-anthropic-rules.md`](assets/skills/aup-audit/8sync-anthropic-rules.md), ship inside the binary and load into every Claude Code session. A weekly workflow (`legal-sync`) snapshots Anthropic's own texts into [`docs/legal/anthropic/`](docs/legal/anthropic), commits any change and opens an issue to review the rules; with an `ANTHROPIC_API_KEY` repo secret, Claude Code drafts that update as a pull request.

---

## Forge: the AI shell

```bash
cd <project>
8sync forge core          # zsh bound to the "core" conversation (create or resume)
8sync forge core --tui    # same conversation in Forge's full-screen TUI
8sync forge core -p "…"   # one-shot prompt
8sync forge ls | new <n> | rm <n> | status
```

Each name maps to a persistent Forge conversation per repo, so `8sync forge core` tomorrow continues today's thread. In the shell, the prompt looks like this:

![8sync forge prompt: repo, branch, session, Forge agent, tokens, model, duration](docs/assets/forge-prompt.png)

| Prompt part | Shows |
|---|---|
| `su-code/crates` | Path relative to the repo root |
| `on main` | Git branch |
| `core` | Session name |
| `FORGE 48.5k` | Agent and tokens used in this conversation |
| `claude-opus-5-5 MEDIUM` | Model and reasoning effort |
| `3.2s` | Duration of the last command, when it took ≥ 2 s |
| `❯` | Green after success, red after a failure |

| Type | Does |
|---|---|
| `: <prompt>` | Ask Forge in this session's conversation |
| `:<Tab>` | Forge commands: `:model`, `:provider`, `:agent`, `:new`, `:commit`… |
| `@<Tab>` | Attach a file to the prompt |
| `↑` / `↓` | History search by what you've typed |
| `→` | Accept the grey suggestion |
| `Tab` | Completion menu (arrows to pick, Shift+Tab back) |

Speed (Windows, measured in a pseudo-terminal):

- About 0.3 s from `8sync forge core` to a usable prompt.
- The Forge segment renders asynchronously, so the prompt never waits for it.
- Branch and repo come from `.git/HEAD` directly, with no `git` process per prompt.

Your own `~/.zshrc` loads first, and 8sync's managed files never overwrite it.

---

## Commands

### Daily loop

| Command | What it does |
|---|---|
| `8sync .` · `8sync . <name>` | Resume the project's omp session, or a named one. `. new <name> --worktree` gives a feature its own git worktree + branch; `. merge <name>` lands it locally. |
| `8sync ai "…"` | One-shot prompt; empty resumes the session. `--model <alias>` overrides the model. |
| `8sync ccc . <name>` | Claude Code session by name, with the kit ([above](#claude-code-8sync-ccc)). |
| `8sync forge <name>` | AI shell ([above](#forge-the-ai-shell)). |
| `8sync find <kw>` | ripgrep + fzf, opens `file:line` in your editor. |
| `8sync run dev\|build\|test\|fmt\|lint` | Project command from the detected stack. |
| `8sync ship "msg"` | add · commit · push · `gh pr create`. |
| `8sync note "msg"` | Append to `su-code/NOTES.md`; agents read it next session. |
| `8sync feature new <slug>` | Multi-phase feature plan with per-phase acceptance gates. |

### Harness

| Command | What it does |
|---|---|
| `8sync trail [dir\|--all [ROOT]\|status\|off]` | STEP 0: installs trail-code (telemetry off), runs `trail init` for Claude (no global hooks) and git-ignores `graft/`; `--all ROOT` sweeps every git repo (depth ≤3), `--dry-run` supported. |
| `8sync harness` | One idempotent command per repo: skills, `trail build`, `AGENTS.md` force-load block, `su-code/` memory. |
| `8sync harness init` · `create` | First bootstrap with managed `.gitignore` + gitleaks pre-commit hook · plus Cursor and Z.ai Code skill/rule fan-out. |
| `8sync harness global [--sweep]` | Apply rules, skills, MCP and hooks to every omp project on the machine. |
| `8sync harness web` | Local dashboard at `http://127.0.0.1:8731` (see below). |
| `8sync harness bench` · `toolstats` · `audit` · `eval` | Context budget · code-intelligence vs grep usage · doc hygiene · quality suite. |
| `8sync harness add-model` · `add-local-model` · `compaction` | Register a remote model · serve a local GGUF via mistral.rs · set the compaction threshold. |
| `8sync skill [add <url>[@ref] \| update \| gen]` | Skill library; `@ref` pins a commit in `skills.toml`. |

### Lifecycle

| Command | What it does |
|---|---|
| `8sync setup [--profile <name>] [--dry-run]` | Stage A harness + opt-in profiles: `terminal`, `dev-stack`, `nvidia`, `warp`, `bluetooth`. |
| `8sync up [--to vX.Y.Z]` | Self-update from GitHub Releases, sha256-verified. `8sync omp update` updates omp. |
| `8sync doctor` · `flow` · `help` | Health check · workflow-ordered help · cheatsheet. |

### Tools for agents

| Command | What it does |
|---|---|
| `8sync shot` · `diff-img` · `pdf-img` | Web page/file, git diff or PDF → PNG for vision models. |
| `8sync gen-img "…"` | Generate an image (`gpt-image-2`). |
| `8sync locate <img> "<target>"` | Visual grounding: boxes and click coordinates (LocateAnything-3B, non-commercial licence). |

### Machine (Linux desktop)

| Command | What it does |
|---|---|
| `8sync sec` · `vpn` | WARP + ufw toggle · SoftEther + VPN Gate relays. |
| `8sync bt` · `hz` · `lcd` | Bluetooth repair · highest refresh rate per display · Lian Li screens. |
| `8sync clean` · `theme` · `bg` | Disk/RAM cleanup · kitty palette · kitty wallpaper. |

Every verb has `-h` with an `EXAMPLES` block.

---

## Dashboard

`8sync harness web` serves an axum + React app embedded in the binary. Every page reads real files, and most pages write changes straight back to them.

| Group | Pages |
|---|---|
| Session | Live plan (`su-code/STATE.md`), token and compaction stats |
| Configure | Models per role, 50+ skills, memory files, rules |
| Runtime | Engines, code graph (call graph + Leiden clusters + caller tracing), MCP, submodules |
| Quality | Bench, readiness, team |
| Discover | One-click MCP servers and skills from the official registry, Smithery, Glama, mcp.so |

![Dashboard: live plan](docs/assets/dashboard-state.png)

---

## Project memory

`8sync .` or `8sync harness` seeds a memory every AI tool reads (omp, Claude Code, Cursor, Forge, aider):

```text
<repo>/
├── AGENTS.md          anchor: force-loaded skills and rules
└── su-code/
    ├── STATE.md       the live plan, rewritten at every phase
    ├── KNOWLEDGE.md   validated lessons and recorded failures
    ├── DECISIONS.md   architecture decisions
    ├── PREFERENCES.md how you like things done
    ├── NOTES.md       `8sync note`
    └── skills/        project-local skills
```

---

## Build from source

```bash
git clone https://github.com/8-Sync-Dev/8sync && cd 8sync
bash scripts/bootstrap.sh            # rustup if missing → cargo build --release → ~/.local/bin/8sync
```

| Topic | Details |
|---|---|
| Layout | `crates/cli/src/main.rs` routes; one file per verb in `crates/cli/src/verbs/`; pure core (session registry, transcript view, secret masker, JSON rows) lives in `crates/ccc-core` (stable surface ZUS pins by git tag). |
| Embedded assets | Configs, skills and the zsh config in `assets/`, embedded with rust-embed. |
| Dashboard | Built from `web/` by `build.rs`. |
| Binary size | `bash scripts/size-report.sh` attributes size; `scripts/size-gate.sh` enforces the ceiling in CI. `--no-default-features` drops the dashboard (3.1 MB). |
| Releases | A `v*` tag builds 5 targets and publishes them with digests. |
| Contributing | [`AGENTS.md`](AGENTS.md) is the guide for contributors and their agents. |

---

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for personal study, hobby projects, research, education, charities and government. Use at or for a company, client work, or a paid product or service needs a commercial license; see [`COMMERCIAL.md`](COMMERCIAL.md). Releases up to and including v0.98.4 stay under MIT. Support the work on [GitHub Sponsors](https://github.com/sponsors/8syncdev). Built by [8 Sync](https://github.com/8-Sync-Dev).
