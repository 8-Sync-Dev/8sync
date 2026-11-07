<div align="center">

<img src="docs/assets/logo-8sync.png" alt="8 Sync logo: a blue-to-green figure eight" height="120">

# 8sync

**One command opens any coding agent in your repo. One HQ shows them all.**

[![Latest release](https://img.shields.io/github/v/release/8-Sync-Dev/8sync?label=release&color=2f9e44)](https://github.com/8-Sync-Dev/8sync/releases/latest)
[![Platforms](https://img.shields.io/badge/Linux%20%C2%B7%20macOS%20%C2%B7%20Windows-1c7ed6)](#install)
[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-495057)](COMMERCIAL.md)

[Website](https://get.8syncdev.com) · [Install](#install) · [Quick start](#quick-start) · [Engines](#engines) · [/solo](#solo-hand-it-the-backlog) · [Code search](#code-search-a-map-before-a-file) · [HQ](#8-sync-hq) · [Tiếng Việt](docs/huong-dan.md)

</div>

`8sync` is a single Rust binary from 8 Sync. `8sync . <name>` opens a named coding-agent session in the current repo, or resumes it if it exists. `8sync hq ui` puts every session on the machine in one local dashboard, which you can also open from your phone.

omp and Claude Code are the engines we run every day and test; omp is the default. The long-term goal is every coding-agent CLI, each one visible and controllable from HQ.

![8 Sync HQ: rooms, a room's log and the results tab, from a real machine](docs/assets/hq-loop.gif)

## Install

```bash
curl -fsSL https://get.8syncdev.com/install | sh      # Linux / macOS
```

```powershell
irm https://get.8syncdev.com/install.ps1 | iex        # Windows PowerShell
```

No git, Rust or admin rights. The installer checks the binary's sha256, puts it on your PATH, then sets up gh, omp, Claude Code with the 8sync kit, Forge with zsh, skills and MCP servers. Every step is idempotent; a step that fails is reported and the rest still installs. Check with `8sync doctor`, update with `8sync up`.

## Quick start

```bash
cd my-app
8sync . api                           # omp session "api" in this repo: create or resume
8sync . api --mode claude-code-cli    # the same, on Claude Code with the 8sync kit
8sync hq ui                           # every session in a dashboard on http://127.0.0.1:8740
8sync hq ui --public                  # plus a one-time login link for your phone
8sync hq ui --tailnet                 # or: a fixed https://<machine>.<tailnet>.ts.net only your Tailscale devices reach
8sync hq ui --at-login                # Windows: start the --tailnet HQ every time you sign in
```

Each name is one conversation per repo, so `8sync . api` tomorrow continues today's thread. 8sync never opens a session or sends a prompt on its own: every session is one you open, in a terminal or from HQ.

## Engines

Pick the engine with `--mode`; set `SUSYNC_MODE` to change your default.

| Engine | `--mode` | Status |
|---|---|---|
| [omp](https://omp.sh) | `omp` (default) | Tested daily |
| [Claude Code](https://code.claude.com) | `claude-code-cli` (aliases `claude`, `ccc`) | Tested daily, runs with the 8sync kit |
| [Forge](https://forgecode.dev) | `forgecode` (alias `forge`) | Supported |
| Codex CLI | `codex-cli` | Planned, not available yet |

**Claude Code mode** loads the 8sync kit from `~/.claude`: a guard that refuses deletes outside the repo, force-pushes and printing `.env` or keys; a verify hook that runs the build after every edit; stop and ask gates that keep Claude working instead of ending on a plan; and six levels of hands-off work, from `/do` to `/solo`. Bypass mode is locked. Its own verbs: `8sync ccc help`.

**Sign-in, the official way.** Claude Code signs in with Anthropic's own login (`claude auth login`). omp and Forge use your own API key against the provider's official API. 8sync never proxies a consumer subscription.

## /solo: hand it the backlog

Type `/solo` once in a Claude Code or omp session and it works the backlog until you say `dừng` or `/solo stop`. The design follows DeepSeek's Super-Agent prototype ([`dsh-superagent-prototype`](https://github.com/deepseek-ai/dsh-superagent-prototype), MIT): spend as little of your attention as possible.

- **Router and Workers.** Your session is the Router: it picks items from labelled issues (`ccc`/`8sync`), the Next list in `su-code/STATE.md` and unguarded `failure:` lines in `su-code/KNOWLEDGE.md`, and never edits code. Each item gets its own Worker, worktree and `solo/<slug>` branch, up to `--workers 2` at once.
- **Blast radius first.** A Worker runs `graphify explain`/`graphify path` before any edit and writes `Impact:` into the item's `PLAN.md`; Workers only run side by side when their impact doesn't overlap. Stuck on the same failure twice, it researches (the code, the web for larger choices) and keeps the findings in `research.md`.
- **Merge and release on green.** Review, `8sync ccc risk`, `/sec` and CI green on Windows, macOS and Linux; a diff of 200 lines or fewer (`--merge-lines`) is squash-merged and released. Bigger diffs wait for you, `--no-release` stops at merge, and production deploy is never granted.
- **Questions don't block.** One question at a time goes to `su-code/ship/solo/SOLO.md`, and HQ pins it with one button per option. Away for more than 15 minutes (`--answer-after`)? A strict Critic picks for your original goal, except on destructive steps, red CI, secrets, production data or billing. `solo: override <option>` corrects it.
- **Inferred work waits.** Items you didn't write (a bot's issue, a failure line) are only logged as `would accept:` until you send `/solo --accept auto`. After a restart it checks worktrees, git, PRs and CI before repeating any push, merge or release.

| Level | Type | Runs until | Needs you |
|---|---|---|---|
| 1 | `/do <task>` | one edit, three files or fewer | to look at the diff and commit |
| 2 | `/ship <task>` | a commit on a branch | to push |
| 3 | `/ship-auto <task>` | PR, CI green on 3 OSes, merge, tag, release | only for an irreversible, production or billing choice |
| 4 | `/ship-loop <goal>` | every acceptance check exits 0, then merge and release | when a cap is hit (12 rounds, 90 minutes, stuck) |
| 5 | `/autopilot` | up to 5 backlog items or 8 hours | to read the brief in `su-code/STATE.md` |
| 6 | `/solo` | you stop it (12 hours by default) | at a hard rail, or to say `dừng` |

You start levels 3 to 6, an agent can't, and the command you type is the permission to merge and release for that session and repo. Levels 3 to 6 and `/ship-tick` also run in omp (since v0.131.0); omp has no cron, so they run as an `engine_plan` loop that continues up to 8 times in a row, and typing the command again picks up where it stopped.

## Code search: a map before a file

Every session starts at STEP 0: questions about code go to a local code map, with no model call, before any file is opened. graphify answers who calls X, what X calls, impact and the path from A to B; trail answers where X is and what a file looks like. Measured on the 8sync repo itself (Windows, November 2026):

| Question | Command | Time | Answer size |
|---|---|---|---|
| Who calls X, what X calls, impact | `graphify explain <symbol>` | 1.4 s | ~170 tokens |
| The same, without graphify | `trail callers <symbol>` | 7.5 s | ~92 tokens |
| Where is X, text with its symbol | `trail grep <pattern>` | 0.8 s | ~161 tokens |
| Reading the file instead | a 2,000-line file | | ~23,000 tokens |

`graphify update . --no-cluster` builds the graph: 20.6 s the first time on 15,406 nodes, about 2 s after each edit. Path from A to B: `graphify path "A()" "B()"`; a file's outline: `trail skeleton <file>`. The installer sets up both (graphify needs `uv`).

## 8 Sync HQ

`8sync hq ui` serves a local web dashboard on `127.0.0.1:8740`: which session is working and which waits on you, each room's log and chat, the reports sessions post, a web terminal, and the machine's RAM, CPU and GPU. Type `/` in a room's message box for what that session can run: omp's built-ins and commands (including `/solo` and the other loops), Claude Code's commands, and the skills in `~/.claude/skills`. `--public` prints a login link through a Cloudflare quick tunnel (needs `cloudflared`); anyone with the link controls your sessions, so keep it to yourself. For a fixed address on your own Cloudflare domain, run `8sync hq ui --tunnel-setup hq.example.com` once; `--public` then always uses `https://hq.example.com` (`--tunnel-off` goes back to the quick tunnel).

| Office | A room's log |
|---|---|
| ![HQ office: every room by project, what each is doing](docs/assets/hq-01-van-phong.webp) | ![A room: its live log of tool calls, the chat and the message box](docs/assets/hq-02-phong-nhat-ky.webp) |

![HQ results: a release note a session posted, open in the preview pane](docs/assets/hq-03-ket-qua-roadmap.webp)

Screenshots and the [13-second demo](docs/assets/hq-demo.mp4) (Vietnamese voice-over) come from a real HQ; private data is blurred.

## Project memory

`8sync .` seeds a memory every agent reads at start, whichever engine runs:

```text
<repo>/
├── AGENTS.md          the 8sync block: STEP 0 (graphify + trail code map) and memory rules
└── su-code/
    ├── STATE.md       the live plan
    ├── KNOWLEDGE.md   validated lessons and recorded failures
    └── DECISIONS.md   architecture decisions
```

## Docs

- [docs/huong-dan.md](docs/huong-dan.md): the full guide, in Vietnamese
- [AGENTS.md](AGENTS.md): every verb and option, layout, build and release rules
- [docs/hq.md](docs/hq.md): HQ on Discord · [docs/known-issues.md](docs/known-issues.md)
- [CHANGELOG.md](CHANGELOG.md) · `8sync --help` · `8sync ccc help`

Build from source: `git clone https://github.com/8-Sync-Dev/8sync && cd 8sync && bash scripts/bootstrap.sh`.

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for personal study, hobby projects, research, education, charities and government. Use at or for a company, client work, or a paid product or service needs a commercial license; see [`COMMERCIAL.md`](COMMERCIAL.md). Releases up to and including v0.98.4 stay under MIT. Support the work on [GitHub Sponsors](https://github.com/sponsors/8syncdev). Built by [8 Sync](https://github.com/8-Sync-Dev).
