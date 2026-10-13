# Changelog

Mọi thay đổi đáng kể của `8sync` ghi vào đây. Format theo [Keep a Changelog](https://keepachangelog.com),
versioning theo [SemVer](https://semver.org). **8sync rule:** mỗi PR cập nhật mục `Unreleased`.

## [Unreleased]

## [0.78.0] — 2026-10-13
### Added
- **`8sync ccc statusline`: a Claude Code status line.** Row 1: model (+ effort), context bar (green below 50%, yellow 50–80%, red above 80%), 5h and 7d rate limits with reset countdown (`↻ 1h23m`, only when Claude Code sends them), session cost, `+lines/-lines`. Row 2: branch (`*` when dirty; 50 ms git budget), PR `#12 ✓/●/✗` from Claude Code's own `pr` field (no `gh` calls), tasks done/total with the current task, fresh watchdog alert, `ccc loop` iteration, `🚢 grant` while the session holds a ship grant. Respects `COLUMNS`, never fails (falls back to `8sync · <model>`).
- `8sync ccc statusline --agents` for `subagentStatusLine`: `⚙ 2 running (task 3m12s · reviewer 40s) · 1 idle`.
- `8sync ccc statusline --install` / `--uninstall`. `ccc kit --remove` also restores your previous statusLine. A foreign `statusLine` is parked as `statusLine_prev` in `~/.config/8sync/features.toml` and chained: it runs with the same stdin and its output becomes the last row. `8sync ccc kit` installs it only when no `statusLine` exists and prints a hint otherwise.
- **ccc JSON surfaces** (`docs/hq-ui-contract.md` section 4): `8sync ccc . show <name> --json` / `8sync show <name> --json` (adds `last_users`, `last_text`, `tasks`, `files`, masked), `8sync ccc kit status --json`, `8sync ccc login-kind [--json]` (presence checks only, never prints a token or email). Every ccc/ls JSON output now carries `"schema": 1` (on each row for arrays).

## [0.77.0] — 2026-10-13
### Added
- **`--offline` for `8sync ccc`** (`new <name>`, `<name>`, `.`, `kit`; or `EIGHTSYNC_OFFLINE=1`): no network step runs — no auto-update, no background update probe, no Claude Code installer (`claude` must already be on PATH), no `claude mcp add-json` mirroring. Kit files and local skill linking still install. Each skipped step prints one `skip` line. All of these go through one `net_allowed` gate, covered by unit tests.

### Fixed
- Security: `8sync ls/show` and the HQ journal printed passwords typed in prose ("sudo password của tôi là …", "mật khẩu: …", "pass: …", "password is …"). The shared masker (`secret_mask.rs`) now masks the value after pass/password/passwd/pwd/pin/otp/secret/token/api key/mật khẩu/sudo triggers; ordinary prose ("password reset flow", "sudo apt install") is left alone.
- Floor: desk subtitle no longer shows a truncated full session uuid; a paired hq session id goes to `sid` and keeps the ls name (`apps/hq-ui/lib/floor.ts`, `lib/server/floor.ts`).
- Session registry (`index.json` for `forge` / `ccc .`) is now written atomically under an exclusive lock (`index.json.lock`, tmp + rename) through one `update` helper, so concurrent launches no longer lose entries; a corrupt index is kept as `index.json.corrupt-<unix>` and rebuilt instead of silently dropped. On-disk format unchanged.



## [0.76.0] — 2026-10-13
### Added
- **Five graded auto commands for ccc** (all inside official Claude Code; no bypassPermissions): `/do <việc>` (one small change, no plan, no commit, light checks), `/ship` (full process), `/ship-auto` (ship through PR → CI → merge → release → install → monitor with ONE "Ship" question), `/ship-loop <mục tiêu>` (acceptance criteria with check commands, iterate implement → check → fix with evidence in `LOOP.md`, caps `--max-iter 12` / `--max-min 90`, stuck and no-change detection via `8sync ccc loop`; Claude Code's built-in `/goal` can be layered on top by the owner), `/autopilot` (unattended backlog: issues labelled ccc/8sync → STATE Next → KNOWLEDGE failures; one Ship question per batch; respects other sessions' lanes). Levels 3–5 are owner-invoked only (`disable-model-invocation`).
- `8sync ccc loop <init|tick|status|done|ls>`: bounded-loop state (`su-code/ship/<slug>/loop.json`) with stop rules max-iter, max-min, stuck (same digest twice) and no-change; kit gains the `do`, `ship-auto`, `ship-loop`, `autopilot` skills (`ship-loop`, `autopilot` stay core).
- `8sync ls --json` rows gain `sid` (Claude session uuid for `claude`/`ccc` engines, `null` otherwise); other fields unchanged.

### Fixed
- **hq-ui "Văn phòng": a running Claude session no longer shows as two desks.** The floor now joins an hq session to its `8sync ls` row by session id, then by name, then by folder (`~` expanded; an agent working in a subfolder or worktree of the repo still matches when that is unambiguous). Matched sessions are never appended again. A truly unknown hq session still shows, labelled with its 8-char id instead of the full uuid, after the matched desks.

## [0.75.0] — 2026-10-13
### Changed
- Release size ceiling 6080 → 6144 KiB from the measured v0.74.0 linux-x86_64 asset (6,231,472 B, 5,552 B over: taste-skill variants + `ls` fields). v0.74.0 was tagged but not published; this release carries everything listed under 0.74.0.

### Added
- **Ship once, not at every step.** Claude now asks a single `AskUserQuestion` with header "Ship" that lists every merge, push to main, tag, release, publish and production deploy it will do. Options: "Duyệt tất cả", "Chỉ merge, chưa deploy" or "Dừng".
  - Claude Code passes the owner's answer to the new `ccc hook ship-grant` (PostToolUse on AskUserQuestion), so it cannot be forged. The hook writes an 8-hour grant for that session (0600 file).
  - The guard then lets those shipping steps through without a prompt each time. "Chỉ merge" grants shipping but not production deploys.
  - Deny rules (force-push, deleting roots, secrets) never look at a grant. A command that also contains a non-shipping ask still prompts.
  - Before this, every `gh pr merge` or `vercel --prod` prompted separately.

## [0.74.0] — 2026-10-13
### Added
- **`8sync hq ui` "Văn phòng" (default tab): every Claude Code / omp session is a pixel coworker at a desk.**
  - Seven code-drawn 32×32 animated states: resting, typing, running a command, reading/searching, waiting for you (raised hand), stuck (red "!"), done (cheer).
  - Each desk shows a Vietnamese text label, one caption line and task progress; waiting and stuck desks come first, and old idle ones are collapsed.
  - The sprites are drawn in the browser on a canvas: no image files, no image-generation APIs.
  - The animation runs at about 7 fps, pauses while the tab is hidden or the desk is offscreen, and shows a single frame under `prefers-reduced-motion`.
  - Data comes from the new token-gated `/api/floor` (`8sync ls --json --all` + hq sessions, 4 s cache, single flight).
  - Desks are grouped by repo. Working, waiting and stuck sessions sit as large desks (character ~100 px) in one shared pixel room per repo. Idle and done sessions show as one line each (state, name, engine, last line, age). Repos with someone waiting or stuck come first.
  - Each desk shows an engine badge (Claude / omp). Repeated names inside a repo get the 8-char session id (or `#n`). Leading emoji and ALLCAPS tags ("🔗 TRACE:") are hidden from titles; the full title stays in the tooltip.
  - Waiting desks get a lime ring and a "Chờ anh" badge; stuck desks get a red ring and a "Kẹt" badge.
- **Sidebar: projects whose folder no longer exists fold under "Không còn thư mục (N)".** `GET /api/projects` now returns `missing` per project. No data is deleted.
- **`8sync ls --json` rows gain `last_tool` and `stalled_error`.** `last_tool` is the raw name of the latest tool. `stalled_error` is the API error that the kit's StopFailure hook recorded for that Claude session within the last 24 h.
- **HQ UI on brand and simpler.**
  - 8 Sync mark and lime-on-near-black tokens (WCAG AA checked in light and dark); Geist and Be Vietnam Pro fonts.
  - Readable session names instead of uuids, with old or ended sessions under "Older".
  - The composer is replaced by a "Start a session" action when no session is running.
  - Chat is rendered with Vercel AI Elements components (display only: no model calls, no keys).
- CI runs hq-ui typecheck (`next typegen` + `tsc`) and vitest, and uploads the packaged hq-ui tarball as an artifact for local UAT without building.
### Changed
- **Release notes come from CHANGELOG:** the release workflow publishes the version's CHANGELOG section plus an install line, followed by GitHub's generated PR list. Before this, the notes were only the PR title. The v0.72.0 and v0.73.0 notes were rewritten the same way.
- `taste-skill` (design-taste-frontend) refreshed from upstream Leonxlnx/taste-skill d237dd3 (MIT, LICENSE now shipped). Five plain-markdown variants are added as skills: `taste-brutalist`, `taste-minimalist`, `taste-soft`, `taste-redesign` and `taste-output`. Variants that need image generation or Google Stitch are left out.

## [0.73.0] — 2026-10-13
### Added
- **`/ui-ux <việc>`**: an easy-to-type entry point for UI/UX work. The `/` menu matches skill names, so `/ui` never found `impeccable`. It opens `impeccable` (the 8 Sync design system) first and routes to the right sub-command, then to taste-skill, frontend-ui-engineering, senior-frontend, nextjs-app or browser testing when they fit.
- The kit links **every** skill in `~/.omp/skills`, not only the 29 8sync ships. Previously `frontend-ui-engineering`, `browser-testing-with-devtools`, `api-and-interface-design` and others were missing from Claude Code.
- **Workspace skill libraries for every ccc session:** `8sync ccc kit --skills-from <dir>` registers a skill folder, for example `~/startup/8sync-startup/su-code/skills` with its 237 skills (`loop-me`, `grill-me`, `agent-browser`, `live-verify`…). Before this, those skills only existed inside that repo.
  - Each kit run links every skill Claude Code doesn't have yet into `~/.claude/skills`. Kit files, bundled skills and the owner's own skills are never overwritten.
  - Library skills are listed by name only (`skillOverrides`), so a large library barely grows the session prefix.
  - The libraries are kept in `features.toml` as `skill_libraries`.

## [0.72.0] — 2026-10-13
### Fixed
- Guard: a data here-doc later in the command (`cat > report.md <<'EOF' … for … () …`) no longer turns off variable resolution, so `S=/tmp/x/scratchpad; rm -rf $S/target` stops asking (seen live in a subagent's cleanup).

### Added
- **Watchdog soft remedy + early warning:** under sustained pressure (MemAvailable, load, or PSI `/proc/pressure` memory/io full, cpu some) busy session processes — compilers, linkers, bundlers (new `build` list) and watched runtimes, above 25% CPU — get `renice 19` + `ionice -c3` once (they keep running; never killed), and Claude is told to stop parallel agents/builds and use CI. PSI gives its own `pressure` alert, earlier than MemAvailable/load.
- **Watchdog GPU without vendor tools:** AMD GPUs are read from sysfs (`gpu_busy_percent`, `mem_info_vram_*`) and warn on busy/VRAM; `8sync watchdog status` shows the GPU sources, says when an NVIDIA card is present but unmeasured (no `nvidia-smi`), and prints PSI.
- **Session fence (Linux, systemd --user):** `8sync ccc .` runs claude inside `8sync-ccc.slice` — shared by all ccc sessions, `MemoryHigh=70%` (soft: the kernel throttles, never kills), `CPUWeight=50`, `IOWeight=50` — so a heavy session slows down instead of freezing the desktop. Off: `EIGHTSYNC_FENCE=0` or `session_fence = false` in features.toml.
- **Kit rules: no heavy local builds; sessions work as a team.** Heavy build/test goes to GitHub Actions (`gh workflow run` → `gh run watch` → `--log-failed`); locally only light checks under `nice -n 19 ionice -c3 -j2`; never flip repo visibility for free minutes. Sessions check `8sync ccc . ls` / ListAgents first, split overlapping work and announce shared changes via SendMessage.

## [0.71.0] — 2026-10-13
### Added
- **Stop gate checks the task list:** when Claude touched its tasks (TaskCreate/TaskUpdate/TodoWrite) since the owner's last message and still has open tasks of this turn (in progress, or created since that message — older pending ones are left alone), a silent stop is blocked once with their titles ("finish them, or mark them completed/deleted, or say what you need"). A question to the owner, a hand-off, a risky action, the owner saying stop, or a second stop in a row still end the turn. Never blocks an agent-team lead (TeamCreate/SendMessage: teammates' completions are not in its transcript) or a transcript only tail-scanned (> 24 MB). Measured on a 14 MB transcript: 34–38 ms (release); 5 ms when tasks were not touched this turn.
- **Turns that die on an API error are caught:** `ccc hook stop-failure` (Claude Code's `StopFailure`: rate_limit, overloaded, server_error, max_output_tokens, …) records the error per session (0600 file in a 0700 dir under `~/.local/state/8sync/ccc/stopfail`, dropped after 24 h; nothing written without an absolute HOME) and shows a desktop notification; on the next prompt in that session — even a bare "tiếp" — `ccc hook resume-note` tells Claude its last turn ended early and to check TaskList and `su-code/ship/ACTIVE` before continuing (said once). StopFailure itself cannot make Claude continue (docs: no decision control).

## [0.70.0] — 2026-10-13
### Added
- **`/ship` runs the whole team process:** plan → R&D → code → test → UAT → review/QC (`/sec`, `/aup-audit` when triggered) → docs + memory → commit; with a trailing `--release`/`--deploy` flag it goes on to PR → CI → merge/tag/deploy → monitor (no push without it). State lives in `su-code/ship/<slug>/STATE.md`; `su-code/ship/ACTIVE` names the running one and the session-start digest puts its head first, so it survives /compact, /clear and resume.
- **`/planning`** (plan only: acceptance criteria, tasks by file, risks, one batched question), **`/remember`** (one evidence-backed `failure:`/`validated:`/`decision:` line in `su-code/KNOWLEDGE.md`) and **`/consolidate`** (dedup/prune memory, owner approves once). Kit: 22 files.
- **Session thread survives /compact and resume:** `ccc hook session-start` (matcher now `startup|resume|clear|compact`) appends this session's latest owner requests, open tasks first and recent files (masked, ≤ 3 KB; STATE digest + block ≤ ~9 KB, under the 10,000-char hook cap). Measured on a 14 MB transcript: 149 ms (debug build).
- Release size ceiling 6016 → 6080 KiB (+14,320 B local gnu vs v0.69.0, embedded skills; attribution in `scripts/size-gate.sh`).
- **Guard asks before shipping:** push to `main`/`master`, tag pushes (`v1.2.3`, `--tags`, `--follow-tags`), push to an `encore` remote, `gh pr merge`, `gh release create`, `vercel --prod`, `npm|pnpm|yarn|bun|cargo publish`, `fly|flyctl|wrangler|firebase deploy`. Feature-branch pushes, PRs and dry-runs stay silent.

### Fixed
- Watchdog: machine load is compared with the real core count from `/proc/stat`; under the service's `CPUQuota=5%`, `available_parallelism` reported 1 core, so load > 2 alerted on a 16-core box.
- Watchdog: a RAM/CPU alert for a process that is not a known helper (e.g. `node`) no longer says "keep that helper off"; it says the watchdog only reports it.


## [0.69.0] — 2026-10-13
### Added
- **`8sync watchdog`** — an always-on, std-only guard (reads `/proc`, ~2 s period) for runaway harness helpers. `run [--dry-run]` builds the process trees under `claude`/`omp` plus known helpers (codebase-memory-mcp, serena, headroom, codegraph, tsserver, rust-analyzer…; list in `~/.config/8sync/watchdog.toml`, created with defaults) and, on sustained CPU / RSS, machine MemAvailable or load, GPU memory (optional `nvidia-smi`, 10 s), writes an alert to `~/.local/state/8sync/watchdog/alerts.jsonl` (0600), calls `notify-send`, and — only for known helpers running inside a `claude`/`omp` process tree, never `claude`/`omp`/editors/browsers/runtimes, and never for the `warn_only` indexers (codegraph, LSPs: alert only) — sends SIGTERM then SIGKILL after a grace period; a helper killed more than 3× in 10 min is quarantined in `~/.config/8sync/watchdog-blocked`. `install|uninstall|status` manage a `systemd --user` service (Nice=10, CPUQuota=5%, MemoryMax=64M; other OSes print "not supported yet").
- **`8sync ccc hook watchdog`** (registered by `8sync ccc kit` on `UserPromptSubmit` and `PostToolUse`, synchronous, timeout 5): feeds unseen alerts for this session's process tree or the whole machine to Claude Code as `hookSpecificOutput.additionalContext` (≤ 1,500 chars; per-session cursor; no output and no writes when nothing is new).
- `8sync harness cbm|serena off` removes the Claude Code user-scope entry only when it is the exact launcher 8sync mirrored; an owner-added entry with the same name is kept (hint printed). `features.toml` that does not parse is reported, never overwritten.
- **`8sync watchdog unblock <name>|--all`** allows a quarantined helper again; the blocked list is updated under a file lock with tmp+rename, the running service re-reads it every tick and the helper starts with a clean kill history. Alerts for codebase-memory-mcp / serena point at `8sync harness cbm off` / `8sync harness serena off`.
- Release size ceiling 5952 → 6016 KiB (watchdog + cbm/serena switches: +87,176 B on a local gnu release vs v0.68.0; attribution in `scripts/size-gate.sh`).
### Changed
- **Kit question rules:** questions go in one batched `AskUserQuestion` (≤4, Recommended first, one Submit); when the owner says "tự làm đi"/"auto", Claude picks Recommended for every product/technical question and states assumptions — secrets and destructive/paid/prod/push-main actions still ask. Fewer permission prompts: run in the session dir, `git -C`/absolute paths instead of `cd … &&`, worktrees inside the repo.
- **codebase-memory-mcp is now strictly opt-in (default off).** Its index worker, one MCP server per Claude Code/omp session and a systemd --user daemon pegged the CPU (one worker ~283% / 847 MB, 1.2 GB cache). `8sync harness`, `harness up/auto` and `8sync ccc kit` no longer install, register or index it unless enabled. Toggle with `8sync harness cbm on|off|status` (stored in `~/.config/8sync/features.toml` as `codebase_memory_mcp`; `EIGHTSYNC_CBM=1|0` overrides). `off` also removes it from Claude Code (user scope) and the 8sync-written entry from `~/.omp/agent/mcp.json` (other entries untouched); it kills nothing, only prints a hint. When on, `auto_index` is set to `false` (index on demand only) instead of `true`. A stub binary (`--version` says "disabled"/"(stub)") counts as not installed and is never registered. Kit CLAUDE.md / injected block no longer tell agents to use it first (codegraph CLI first).
- **serena MCP is opt-in too (default off).** Python/JS MCP servers cost a process per agent session; 8sync prefers native/Rust tooling (codegraph CLI, Claude Code LSP plugins). `8sync harness serena on|off|status` (`serena` key in `features.toml`, `EIGHTSYNC_SERENA=1|0` overrides); `ccc kit` and `harness up` no longer register it unless enabled; `off` removes it from Claude Code (user scope) and the uvx entry from omp's mcp.json.
- **Agent guidance is codegraph-first; cbm/serena text is gated on the flags.** Rules, APPEND_SYSTEM, force-load, kit CLAUDE.md, AGENTS/CLAUDE blocks, commands and bashInterceptor messages only mention `mcp__codebase_memory_mcp_*` / `mcp__serena_*` when `harness cbm|serena on` (asset lines prefixed `@cbm ` / `@serena `; `code_intel_available` also requires the flag).

## [0.68.0] — 2026-10-13
### Added
- **`8sync hq ui` works without a repo checkout.** The UI (Next standalone) and the `8sync-hq` channel (one esbuild file, no `node_modules`) ship as a platform-independent release asset `8sync-hq-ui-v<version>.tar.gz` + `.sha256` (built by the new `hq-ui` job in `release.yml` via `scripts/package-hq-ui.sh`, which fails if any native `.node`/`.so` is inside). On first run 8sync downloads it with `curl` (https only), verifies the sha256 (mismatch or no hasher = refuse, existing install untouched), extracts it with `tar` into `.tmp-<pid>` (refuses absolute / `..` entries and any symlink or file that resolves outside the tree), then swaps it atomically into `~/.local/share/8sync/hq-ui/<version>/`, then runs `node hq-ui/server.js` (no pnpm). It also writes `~/.config/8sync/hq/channel-mcp.json` (0600) for the installed channel and defaults `HQ_CHANNEL_FLAGS` for the UI process. Resolution order: `--app` / `EIGHTSYNC_HQ_UI_APP`, installed copy, a *built* `~/tools/su-code/apps/hq-ui`, else download. `8sync hq ui --update` reinstalls; `EIGHTSYNC_HQ_UI_TARBALL=<file>` installs a local tarball (sha from `<file>.sha256`).

- Install hardening: `<base>/.install.lock` (stale after 10 min), failed update restores the previous install, leftover `.tmp-*`/`.dl-*`/`.old-*` older than 1 h are cleaned, only the current and previous version dirs are kept. The `.sha256` comes from the same release as the tarball, so it checks integrity (corrupt/partial download), not an independent root of trust; when the GitHub API lists an asset digest it is cross-checked too (mismatch = refuse; API unreachable = warning). The asset has no symlinks (dereferenced when packaged; `ci.yml` job `package-hq-ui` checks it on PRs) and no server-side `*.js.map`. `--update` with `--app` / `EIGHTSYNC_HQ_UI_APP` prints a warning.

### Fixed
- `8sync hq ui --app <dir>` / env / a repo checkout now runs the app's `pnpm start` (fallback `npm start`) instead of `.next/standalone/server.js`, which has no `.next/static` next to it (every CSS/JS asset 404). Only the installed release asset runs `hq-ui/server.js`.

### Changed
- `apps/hq-channel` pins `esbuild` 0.25.12 as a devDependency; the package script uses `pnpm exec esbuild`.
- `apps/hq-ui` builds with `output: "standalone"`, `images.unoptimized` and sharp/libvips excluded from tracing (platform-independent asset). The old `<exe>/../share/8sync/hq-ui` lookup is gone.

## [0.67.1] — 2026-10-13
### Changed
- Release size ceiling 5888 → 5952 KiB from the measured v0.67.0 linux-x86_64 asset (6,030,288 B, 976 B over). v0.67.0 was tagged but not published; this release carries everything listed under 0.67.0.

## [0.67.0] — 2026-10-13 (not published)
### Added
- **`8sync ccc . ls` shows what every session is doing**: `● running` (a live Claude Code process holds it), `● active` (written < 2 min ago) or `○ idle`; the latest request ("ask"), the latest action ("now"), task progress (`todo 3/7 ▸ current task`, from TaskCreate/TaskUpdate/TodoWrite), messages, context tokens and model. Width-aware, secrets masked (title included), reads at most the last 256 KB of transcripts over 24 MB and smaller ones whole, on at most 8 threads (45–115 ms per repo here); a session whose scan fails shows as `unreadable` instead of vanishing. `--json` carries the same fields. `8sync . ls` (omp) uses the same view.
- `8sync ls [--all]` (every session of this repo, or of every repo), `8sync show <name>` (last 5 requests, last answer, task checklist, files touched, resume line), `8sync guide` (Vietnamese quickstart, Claude Code first); full guide in `docs/huong-dan.md`.
- **Local team UI: `8sync hq ui`** (Next.js + shadcn/ui, SQLite via `node:sqlite`, 127.0.0.1 only, local token + Origin/Host checks): add project folders, start official Claude Code sessions in tmux, team chat, kanban board, live session status, an interactive terminal drawer (allow-listed keys: Enter/Esc/↑/↓/Tab/1–3/y/n/typed text) to answer Claude Code's dialogs, activity log. Hooks write a local journal (`~/.local/state/8sync/hq/events.jsonl`, 0600) when `local = true`: tasks, session start/end, cross-session `SendMessage`, and, only for `hq-*` sessions started by the UI, each turn's final answer (Stop hook `last_assistant_message`) and notifications. Every text/subject field passes the shared secret masker first (heuristic: see below). `8sync hq ui` prints a notice when it turns `local` on (and only after the UI process started); `8sync hq ui --off` turns it off; `8sync hq purge [--yes]` deletes `events*.jsonl`, `hq.db*` and `channel-*.json` under `~/.local/state/8sync/hq` (without `--yes` it only lists them). Files are rotated at 5 MB (one `events.1.jsonl` kept) and stay until you purge.
  - Owner messages go to the session through the `8sync-hq` channel when Channels work, else they are typed into the session's own terminal. The UI detects "Channels are not enabled for your org" and uses the terminal, retries an unanswered channel message in the terminal after 25 s, and **refuses (409) to type while Claude shows a dialog**: in a live test, a message typed into the "Teach auto mode" wizard had moved it to "scan shell history: true" (cancelled before Continue).
  - Live UAT on Claude Code 2.1.296 (Team login): folder-trust dialog answered from the UI's key API, owner message → task created/completed → board shows it under the session name → the Vietnamese answer appears in the chat; session `alpha` found `beta` with `ListAgents`, asked it over `SendMessage`, and relayed its answer. Channels on this org are off ("set channelsEnabled"), so the channel path itself is tested with an MCP client only.
- **`8sync ccc . <name> --team`** starts the session with Claude Code agent teams on (env `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` for that launch only, never written to settings); `--panes` shows teammates as tmux split panes (`teammateMode: "tmux"`, inside tmux). `8sync ccc . --team` with no name reopens the last-used session with teams on. Refuses `-p`, `-pc` and `--print=…`, because Claude Code spawns no teammates there. Live: the lead spawned `@helper` from the kit's `quick-task` agent, helper answered, the lead relayed it.
- `8sync ccc kit --remove` takes every 8sync hook entry out of `~/.claude/settings.json` (your own hooks stay, also when they share a group with an 8sync hook). It writes nothing when there is nothing to remove, keeps `settings.json.bak-8sync`, and replaces the file by rename. Run it before uninstalling 8sync: the guard now fails closed. If the binary is already gone, see the manual recipe in `docs/huong-dan.md`.
- **One shared secret masker** (`verbs/secret_mask.rs`) for `8sync ls/show/--json` and the HQ journal: splits on any whitespace, handles `key: value`, `key=value`, `"key":"value"` for token/secret/password/passwd/api_key/apikey/access_key/private_key/authorization/bearer/cookie/session, known prefixes (`sk-ant-`, `sk-`, `ghp_`/`gho_`, `github_pat_`, `AKIA`/`ASIA`, `xox[bpas]-`, JWT `eyJ`, `AIza`, Discord bot token shape) and PEM blocks. Heuristic: a secret with no name and no known shape is not caught, and non-English key names (e.g. Vietnamese "mật khẩu:") are not recognised. Non-ASCII text before `:`/`=` ("Lưu ý:") is handled (a slicing panic found in review is fixed and fuzz-tested).

- **The Claude Code guard now stops destructive shell commands, in Bash and in PowerShell** (`crates/cli/src/verbs/ccc/danger.rs`). Measured against omp 18.9 and Forge 2.14 on direct instructions: both deleted a folder outside the repo, printed `.env` and force-pushed; `8sync ccc` stopped all three: force-push denied by the guard, the outside delete asked first (a denial under `claude -p`), `.env` refused by the org rules before any tool call.
  - **Denied:** deleting a filesystem root, a top-level folder, the home directory, the project or any of their ancestors, or a temp root, also as "everything in it" (`rm -rf *`, `rm -rf */`, `find . -delete`, `Remove-Item -Recurse ~`, `rd /s /q C:\Users\me`, `[IO.Directory]::Delete`); disk wipes (`mkfs`, `dd of=/dev/sdX`, `Format-Volume`, `diskpart`); `wsl --unregister`; force-push in every spelling (`-f`, `-uf`, `--force-with-lease`, `+ref`, `--mirror`, `-c remote.*.push=+…`); printing or uploading a credential file (`cat .env`, `cat .env*`, `Get-Content .env`, `curl -F f=@.env`, `scp .env host:`).
  - **Asked first** (a denial Claude reads under `claude -p`): deletes outside the project and the temp dirs, `rm -rf .git`, targets only known at run time (`$VAR`, `$(…)`, `xargs`, a filtered pipeline into `Remove-Item` such as `gci | ? Name -like x | Remove-Item`), deletes inside `wsl`/`ssh`/`docker exec`/`kubectl exec`, a script piped into a shell (`curl … | bash`), `-EncodedCommand`, unbalanced quotes, `git reset --hard`, `git clean -f`, deleting a remote branch.
  - It reads the command the way the shell does: quotes, escapes, line continuations, `#` comments, here-docs and here-strings, `$(…)`/backticks/`<(…)` (also inside double quotes), `then`/`do`/`!`, `cd`/`Push-Location` tracking, `sudo`/`env`/`timeout` wrappers, `eval`/`iex`, nested `bash -c`, `pwsh -c`, `powershell '…'`, `cmd /c`, `wsl -- …`, `ssh host '…'`, here-docs fed to a shell. A structure-blind pass over the raw text also denies a delete aimed at a root, home or top-level folder and a force-push, so a parsing gap alone cannot let `rm -rf ~` through. In straight-line Bash, a variable set to a literal earlier in the same command is resolved (`out=build; rm -rf "$out"` passes, `X=/; rm -rf "$X"` is denied). Anything that could change the value unseen keeps it unknown (asked): an assignment after `||`, in a pipe or group, or reassigned from a non-literal; values with spaces, globs or `~`; and for the whole command any loop, function, `+=`, `IFS`, `eval`, `source`/`.`, `declare`/`local`/`export`/`read`/`printf`/`let`/`unset`. Scripts handed to another shell (`bash -c '…'`, `ssh h '…'`) are never rewritten. `eval "$(…)"` asks unless it runs a known shell-init generator (`ssh-agent`, `direnv`, `pyenv`, `brew shellenv`…). Everyday work passes: `rm -rf target`, `cd build && rm -rf *`, `rm -f *.log`, `rm -rf /tmp/x-*`, `find . -name '*.pyc' -delete`, `Remove-Item -Recurse .\dist`, `docker rm -f web`, `grep .env .gitignore`, commit messages that mention `rm -rf ~`.
  - The hook matcher includes Claude Code's separate `PowerShell` tool (Windows), which `Bash(...)` rules and `Bash` hooks never covered. About 9 ms per call on Windows, process start included (`8sync --version` alone: 8.6 ms; 30 runs, release build). If the analyser ever panics, the hook answers `ask` instead of letting the command run.

### Changed
- The guard hook fails closed (`onFailure: "block"`, Claude Code 2.1.295+): if it can't start, crashes, times out or returns bad JSON, the tool call is blocked instead of running unguarded.
- Release size ceiling 5760 → 5888 KiB, attributed in `scripts/size-gate.sh` (ls/show/guide ≈ +95.7 kB, HQ journal/launcher ≈ +12.1 kB on local x86_64 builds).
- **Native Stop gate** (`ccc/gate.rs`) replaces the Haiku prompt hook. No model call: it reads the last message and the user's last message from the transcript tail. Ending on an unfinished plan ("Next I'll…", "I'll fix that now.", "Tiếp theo tôi sẽ…") or a routine "shall I proceed?" continues the turn. It ends the turn when the plan is a destructive, outward-facing or paid action, when the question is about secrets, access, money or a choice between options, while a background task is still running, on a second stop in a row, and when the user's last message says stop/wait ("stop", "wait, …", "dừng lại", "khoan") — the rule 0.66.0 added to the Haiku gate, now read from the user instead of Claude's paraphrase. Words match whole words (`fix` ≠ `prefix`) and Vietnamese phrases (`đánh giá`, `khóa học` are not price/key questions). Design brief with sources (CowAgent, oh-my-pi, ForgeCode, Claude Code docs/plugins, public guards): `outputs/stop-gate-guard-design.md`. The Haiku gate cost ~30k Haiku tokens and ~2.6 s per turn end (~48k tokens per bench run), and most of its 20 real blocks were turns waiting for a background agent.
- **claude.ai connectors off by default** (`disableClaudeAiConnectors: true`, only when unset): a trivial `claude -p` on a claude.ai login went from ~8.4 s to ~7.2 s and the prefix shrank by ~2k tokens per request; Gmail/Drive tools are no longer reachable from a prompt injection.
- Same-model bench (Sonnet 5.5; ccc on the team login, omp and Forge on a Console key; Rust, TypeScript, Python and repo-exploration tasks × 2 runs; cost at API list price): every arm 82/82 hidden checks.

  | Harness | Wall median | Requests / run | Output tokens / run | $ / run |
  |---|---|---|---|---|
  | `8sync ccc` 0.65 | 44.4 s | 6.5 | 4,830 | 0.150 |
  | `8sync ccc` dev (0.65 + this change) | 43.1 s | 7.1 | 4,799 | 0.143 |
  | omp 18.9 | 40.1 s | 5.6 | 3,242 | 0.103 |
  | Forge 2.14 | 35.9 s | 6.4 | 4,958 | 0.155 |

  ccc is still a few seconds slower (Claude Code spends ~9.5 s per run outside API time) and omp is the cheapest (fewer output tokens); the gap this change closes is safety, not speed. One dev-build run took 750 s: a here-doc that hit the 120 s Bash timeout went to the background and `claude -p` waited for it.
- Release size ceiling 5632 → 5760 KiB, attributed in `scripts/size-gate.sh`: measured on release builds of v0.66.0 vs this change, separate target dirs — linux-musl (local, zig cc) +114,448 B, Windows +108,032 B. v0.66.0's published linux-x86_64 asset was 5,747,632 B, so the next one is expected near 5.86 MB (5,862,080 B), ~35 KiB under the new ceiling.

### Fixed
- `8sync setup`/package installs on Fedora: dnf5 (5.4.1) rejects `--`, so dnf commands no longer pass it (pacman keeps it); the option-like-name guard stays.
- The guard no longer denies a heredoc that only writes a file (`cat > notes.md <<'EOF' … rm -rf ~ … EOF`); heredocs fed to a shell, interpreter, `eval` or `ssh` stay denied, and `os.system('rm -rf ~')` is now caught.

## [0.66.0] — 2026-10-12
### Security
- **`8sync harness claude-code` only accepts endpoints Anthropic sanctions.** Allowed: `https://api.anthropic.com`, Amazon Bedrock, Google Vertex, Microsoft Foundry, and localhost or one exact host you run yourself (`EIGHTSYNC_SELF_HOSTED_GATEWAY=<host>`). Any other gateway is refused before anything is written: gateways that resell Claude break the Usage Policy ("Do Not Abuse Our Platform"), and your code would go to an undisclosed third party. The official-endpoint check is an exact host match now (`api.anthropic.com.evil.io` used to pass as a substring); plain `http://` is refused except on localhost.
- **Only Console API keys leave Claude Code.** `harness claude-code` writes a token into `~/.omp/agent/models.yml` (and Windows User env) only when it starts with `sk-ant-api`; `harness add-model` refuses non-Console Anthropic tokens and Claude-protocol providers outside the allowlist; `forge key` takes only a Console key for `anthropic` and refuses ForgeCode's `claude_code` provider; the Feynman bridge skips every Claude/Anthropic model. A subscription/OAuth token stays in Claude Code and is not used for the endpoint probe. Tokens are printed as `…` + the last 4 characters (`harness claude-code`, `harness gateway`, `forge`) and kept out of `curl`'s argv. `scripts/setup-claude-key.ps1` and `.sh` now only forward to `8sync harness claude-code` on stdin (the `.ps1` used to write any token for any endpoint into settings.json and the Windows User env first; the `.sh` overwrote settings.json when 8sync was missing). A subscription/OAuth token is accepted only for `api.anthropic.com`, never for localhost or a self-hosted gateway.
- **`8sync harness gateway` no longer routes Claude through the 9router proxy**: the `cc/` provider (which made omp pose as Claude Code) is gone and `apply` removes an already-deployed one. The remaining non-Claude routes need `EIGHTSYNC_GATEWAY_ACCEPT=1`, `gateway key` rewrites only its own provider block, `gateway apply` re-deploys the template but keeps your other providers (backup in `models.yml.bak`), and both refuse Anthropic keys (`sk-ant-…`).
- **`8sync codex-web` is opt-in** (`EIGHTSYNC_CODEX_WEB_ACCEPT=1`): it automates a ChatGPT Web subscription into omp, the same pattern 8 Sync's rules forbid for Claude, and OpenAI's terms for it are not verified. Without the opt-in only `status`/`off` run.
- `8sync forge` writes `~/.forge/.credentials.json` with mode 0600 (and tightens an existing file).

### Fixed
- `8sync feynman` works with Feynman ≥ 0.5.35: the bridge finds Pi's packages under `@earendil-works/*` (then `@mariozechner/*`), in the launcher and the extension (was `Cannot find module '@mariozechner/pi-ai'`).
- Claude 5.5 model IDs (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`) in `harness claude-code`, the `harness model` aliases (`opus`/`sonnet`/`haiku`), the endpoint probe (now `x-api-key` + `anthropic-version`, official endpoint and localhost only) and the kit's gates.
- `8sync ccc kit` says why codebase-memory-mcp / serena were not registered in Claude Code (missing from omp's `mcp.json`, not on PATH, or the `claude mcp add-json` error) instead of skipping silently; serena is registered with `alwaysLoad: false`.

### Added
- **`8sync hq` — Agent HQ on Discord** ([docs/hq.md](docs/hq.md)): `hq setup` builds a private server idempotently: categories, the forum `task-board` (required status/role/priority tags), `rfcs`, `notes`, `#standup`, team rooms, ops channels, persona roles, one webhook per channel, and a pinned charter that says the personas are AI. Claude Code hooks (`TaskCreated`, `TaskCompleted`, `TeammateIdle`, `Notification`) turn team work into forum posts and tag changes posted as PM/Architect/Backend/Frontend/QA/Reviewer/Researcher. Also `hq post`, `hq task`, `hq standup`, `hq status`, and `hq up`, which prints/installs a systemd unit running the lead session with the official Channels plugin in tmux plus a 09:00 standup timer. Tasks are tracked per agent team (or per session), because Claude Code numbers tasks from 1 again in every session; parallel async hooks create exactly one post per task. HQ never touches Claude credentials. The bot token and webhooks live in a 0600 file, are sent to `curl` on stdin, and are always masked; state keeps ids and titles only; a hook is a ~4 ms no-op until setup. Verified against a mock Discord API and with real Claude Code hooks (2 tasks created and completed → 2 tagged forum posts, then `done` + thread comments); the generated units pass `systemd-analyze verify`. Not yet run against real Discord.
- **Security commands in the kit and plugin**: `/rules` (is X allowed? Anthropic AUP/terms + 8 Sync rules + Vietnamese data law, with verdict, exact clause and official link), `/sec` (secrets with file:line and never the value, sensitive files, dependency audit, kit guard, OWASP pass), `/harden` (this machine's Claude Code posture), next to `/aup-audit`.
- **`8sync ccc policy [--org-uuid] [--out] [--strict-hooks] [--lock-mcp]`**: a managed-settings JSON for the org, built only from documented keys. It disables bypass-permissions mode, sets the kit deny rules, can force claude.ai login (optionally pinned to your org UUID), restricts marketplaces to the official one plus 8sync, turns on the sandbox and `channelsEnabled`, and with `--lock-mcp` restricts MCP to codebase-memory-mcp/serena (off by default so the Discord Channels plugin keeps working), and prints per-OS install paths. It never writes system paths itself; `ccc status` shows whether a managed file is present.
- Kit agents `pm` (lead/coordinator, one writer per worktree, aware of the 5-hour window), `architect` (writes docs/ADR/RFC only, no code edits by convention) and `qa` (tests only).
- **Public plugin marketplace**: the kit's subagents and `/ship` install as a Claude Code plugin — `/plugin marketplace add 8-Sync-Dev/su-code` then `/plugin install 8sync-kit@8sync` (~630 tokens always-on per `claude plugin details`); hooks, rules and the full skill set still come from `8sync ccc kit`.
- `8sync ccc kit` enables Anthropic's official LSP plugins (rust-analyzer, TypeScript, gopls, pyright from `claude-plugins-official`) for the language servers found on PATH — code intelligence without MCP schemas in the prompt; values you set are kept.

### Changed
- The Stop gate lets a turn end when Claude's last message quotes the user's own stop/wait words and says it is holding for the next instruction (it used to keep the turn going three times in a row after an explicit stop).
- Release size ceiling 5392 → 5632 KiB, attributed in `scripts/size-gate.sh` (compliance/kit +38,208 B, Agent HQ + policy + skills +193,712 B on local x86_64 release builds).
- **Leaner Claude Code sessions.** Measured on one machine (2026-10-12; `wc -c` of every always-loaded layer, and `message.usage` of the first request in 2 Claude Code transcripts), the kit + repo layers came to 55,663 B (≈13.9k tokens at 4 B/token) of a ~58k-token first request; most of it is gone:
  - the repo `CLAUDE.md` block is compact (≤1.1 KB), no longer orders reading 4 SKILL.md bodies (15.4 KB) before the first tool call, and no longer claims MCP tools are always present;
  - no block in a `su-code/` memory dir, and no new block in a child repo when an ancestor `CLAUDE.md` already has it (Claude Code loads both; they were byte-identical 8.6 KB copies); an existing child block is kept and refreshed to the compact one;
  - the kit's `CLAUDE.md` summarises the 8 Sync / Anthropic rules instead of importing the 6.7 KB rules doc into every session (full text: `/aup-audit`, `skills/aup-audit/8sync-anthropic-rules.md`);
  - on-demand bundled skills are `name-only` in user-scope `skillOverrides` (values you set are kept; core skills keep their descriptions).
- **Kit agents are routed by role**: explore and quick-task on Haiku (`effort: low`), task on Sonnet, reviewer on Sonnet (`effort: high`), with `maxTurns`, read-only `disallowedTools` where they only read, and a short return envelope (reviewer keeps its BLOCKER/SHOULD/NIT + verdict format).
- New kit agents `researcher` and `verifier`, and `deep-research` v2: plan → scale gate → lead drafts → verifier checks every citation → reviewer grades FATAL/MAJOR/MINOR → provenance file, `Verification: BLOCKED` when it cannot finish. Adapted from Feynman (MIT, see `THIRD_PARTY_NOTICES.md`). Private repo source is researched locally, not sent to third-party models.
- The Stop gate (Haiku 5.5) lets a turn end while Claude waits on background agents it launched (it blocked 4 times in a row in a real session); the ask gate stays on Sonnet (5.5). `/ship` requires every "done/verified" claim to cite the command output.
- New `8sync ccc hook session-start` (startup/clear/compact, found from any subdirectory): a byte-stable digest of `su-code/STATE.md` plus recent `failure:`/`validated:` lessons, at most 6,000 B.
- `docs/legal/anthropic/index.md` records the snapshot date; `legal-sync.py` refreshes it only when a page changed.

## [0.65.0] — 2026-10-11
### Added
- **`8sync ccc` keeps itself and the repo current on every launch** (no network on the launch path, never blocks it):
  - a newer 8sync release (found by the 6-hourly background probe) is installed with the usual sha256 check and the same command re-runs on the new binary (`SUSYNC_NO_AUTO_UPDATE=1` opts out);
  - after an update, the bundled skills (`~/.omp/skills`) and the Claude Code kit are refreshed once;
  - a git repo gets the 8sync harness: missing skills vendored into `su-code/skills`, memory + `AGENTS.md`/`CLAUDE.md` blocks, `.claude/skills` → `su-code/skills`, and the managed `.gitignore`.
- **Claude Code sees every 8sync skill.** Project skills come through `.claude/skills` (also created by `8sync harness create`); each bundled skill is linked into `~/.claude/skills/<name>` → `~/.omp/skills/<name>`, and personal skills win over project ones, so Claude Code always reads the current bundled copy. On-demand skills are listed by name only (`.claude/settings.local.json` → `skillOverrides`), always-on skills keep their descriptions: the per-request prefix with 237 skills is 41.1k tokens instead of 57.3k with every description (38.9k with no project skills). Live check: "which command raises the refresh rate to the max?" → Claude invoked `8sync-cli` and answered `8sync hz max`.
- **The org's Anthropic rules ship with 8sync and load into every Claude Code session.** `assets/skills/aup-audit/8sync-anthropic-rules.md` (the 8 Sync rules doc) is installed into `~/.omp/skills/aup-audit/` and `~/.claude/skills/aup-audit/`, and the kit's `CLAUDE.md` block imports it ahead of every other instruction. Live check: three rules questions answered from context with zero tool calls.
- **`legal-sync` workflow**: every Monday it snapshots Anthropic's Usage Policy, Commercial and Consumer Terms, Privacy Policy, Claude Code legal + data-usage pages and the sitemap's `/legal/` index into `docs/legal/anthropic/` (`scripts/legal-sync.py`). A change is committed and opens an issue to review the rules doc; with an `ANTHROPIC_API_KEY` repo secret (Console key), Claude Code drafts the rules update as a pull request. The draft step was rehearsed on a fake effective-date change: it changed only the date reference.
- **Free CI on the public repo**: `ci.yml` runs `cargo test` on Linux, macOS and Windows and builds `--no-default-features` on every push/PR; `install-smoke.yml` runs the published one-line installers on ubuntu x64 + arm64, macOS arm64 + Intel and Windows after each release and weekly, and fails unless the installed version is the latest and setup reports "all steps succeeded".

### Changed
- **Claude Code is about as fast as omp on a hard task now** (was ~1.8× slower). Calc evaluator: 3 bugs + missing features across 4 files, 11 hidden tests, Sonnet 5, Console key, wall-clock per run:

  | Harness | Runs | Mean | Hidden tests |
  |---|---|---|---|
  | omp | 155 · 124 · 136 s | 138 s | 11 · 10 · 11 of 11 |
  | ccc kit 0.64 | 281 · 216 s | 249 s | 11 · 11 |
  | ccc kit 0.65 at `high` effort | 209 · 179 s | 194 s | 11 · 11 |
  | ccc kit 0.65 default (`medium` effort) | 100 · 161 s | 131 s | 11 · 11 |

  - The verify hook is **async** (`asyncRewake`): edits no longer wait for `cargo check` (2.5 s per edit warm on this repo, 8.6 s cold). One check per project runs at a time and the latest edit wins; a failure wakes Claude with the errors.
  - New `8sync ccc hook verify-stop` (Stop): before a turn ends it waits for a running check or checks once, and blocks the stop while the build is broken — once per broken state, so a deliberate stop cannot loop 8 times.
  - `permissions.allow` gets the build/test/lint commands of the supported stacks plus `git add`: in auto mode each would otherwise wait for a classifier review (~0.65 s per `cargo check`). Commits, pushes and anything that discards work stay reviewed.
  - `effortLevel: "medium"` when you have not set one (Sonnet 5 and Opus 5 default to `high`; Opus 5.5 is already `medium`). Output tokens on the bench: 9.4k / 15.3k vs 17.6-20.6k at `high`. Use `/effort high` for a hard reasoning session.
  - Tried and dropped: Anthropic's `<use_parallel_tool_calls>` system-prompt snippet (`--append-system-prompt-file`) did not raise multi-call requests on a lookup task.
- `8sync-cli` skill rewritten harness-neutral (omp and Claude Code) and complete: every verb (sessions, `ccc`, `forge`, `find`, `note`, `run`, `ship`, image tools, `locate`, `gen-img`, harness/skills, `setup`/`up`/`doctor`, `hz`, `bt`, `sec`, `lcd`, `clean`, `codex-web`) plus the `su-code/` memory layout. The old text told agents never to edit `su-code/*.md`, which contradicted `AGENTS.md`.
- `assets/skills/aup-audit/RULES.md` now points at the org rules doc for the 8 Sync rules instead of keeping a second copy.

### Fixed
- **Skill links were committed.** The managed `.gitignore` used `.cursor/skills/` and `.zcode/skills/`, but git sees a symlink/junction as a file and a `dir/` pattern never matches it, so `git add -A` committed the links (this repo tracked both). The block now writes `.cursor/skills`, `.zcode/skills`, `.claude/skills` and `.claude/settings.local.json`; a test runs real `git status` against the links. The two links are untracked here.
- A repo's own committed `.claude/skills/` is never replaced, not even by `harness create --force`.
- **Windows one-liner failed whenever the GitHub API was rate-limited** (shared CI runners, office NAT): `install.ps1` resolved the latest tag with `Invoke-WebRequest -MaximumRedirection 0`, which on Windows PowerShell 5.1 throws without the response, so only the 60-per-hour API fallback ever worked. It now reads the `releases/latest` 302 with a no-redirect `HttpWebRequest` (proven on PS 5.1 and 7 with the API path disabled). Found by the new `install-smoke` run on `windows-latest`.

## [0.64.0] — 2026-10-11
### Added
- **`8sync ccc hook guard`** — a native PreToolUse hook in the kit (Bash/Edit/Write/MultiEdit/NotebookEdit, about 23 ms per call on Windows). It denies, with the reason handed back to Claude:
  - writing a credential file: `.env` / `.env.*` (templates `.example`/`.sample`/`.template` pass), `*.pem`/`*.p12`/`*.pfx`, `id_rsa*`/`id_ed25519*`, `*.session`, `*.pkl` — with either path separator;
  - content or a command carrying a real-looking Anthropic/OpenAI/GitHub/AWS/Slack/Google key or a private key (short fixtures, `EXAMPLE`/`xxxx` placeholders pass);
  - `git add` of a credential file, named or swept up by `git add -A`/`.` (`:!path` exclusions honoured);
  - code that wires a Claude subscription into another client (Claude Code's OAuth client id / OAuth beta headers).
  It replaces the bash + python `aup-guard.sh` from omp-style-kit v2, which let `C:\…\.env` and `.env.staging` through and cost ~240 ms per call.
- **`/aup-audit` skill** (bundled for omp and copied into the Claude Code kit): Anthropic Usage Policy + 8 Sync rules check — gitleaks over tree and history, sensitive files ever committed, then the model reads the product and walks `RULES.md` (Usage Policy sections incl. High-risk Physical Actions, access paths, 8 Sync internal rules). No python scanner: the kit's 240-line regex scanner reported 1 BLOCK + 52 WARN on this repo, all false positives, in 37 s.
- The kit now also ships the `deep-research` skill; more deny rules (`Edit(**/.env*)`, keys, `*.session`, `*.pkl` — `Write(...)` path rules are ignored by Claude Code, so none are used).
- Stage A of `8sync setup` installs **gitleaks** (GitHub release, sha256-checked, `~/.local/bin`), so the pre-commit secret hook exists on fresh machines.
- `8sync doctor` warns when omp's `anthropic` login is a Claude subscription (OAuth).

### Changed
- **Fewer tokens in Claude Code on 8sync repos.** `CLAUDE.md` gets a compact block (~0.7k tokens) that points at `AGENTS.md` and the skill dirs instead of a second copy of the full force-load block (~8k). Per-request prefix in this repo: 41.0k → 34.3k tokens (omp: 56.2k). Importing `AGENTS.md` instead was measured at 20.5k and rejected.
- Kit agents: `explore` runs on Haiku, `reviewer`/`designer` inherit the session model instead of forcing Opus, and the `plan` agent is gone (`/ship` plans in the main context). An unedited `plan.md` from 0.63 is removed on the next `8sync ccc kit`.
- Kit `CLAUDE.md` rules gain the Anthropic Usage Policy points (subscription only in Claude Code / claude.ai, AI disclosure, human review for high-risk decisions, `/aup-audit` before publishing); the "read AGENTS.md first" rule is gone.
- `deep-research` skill rewritten token-lean and host-neutral (omp + Claude Code tools): one artifact (`outputs/<slug>.md`) instead of five, snippets before pages, compressed worker returns, measure-when-you-can. The binary-weight audit protocol moved to `assets/skills/deep-research/references/binary-weight-audit.md`.
- The managed `.gitignore` block also ignores `*.pem`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `*.session`, `*.session-journal`, `*.pkl`.

### Fixed
- **Usage Policy compliance.** `8sync feynman auth-omp` no longer bridges Claude models (omp's `anthropic` OAuth login or gateways serving `claude-*`) into Feynman; set `ANTHROPIC_API_KEY` to a Console key there. `8sync harness claude-code` with a non-Anthropic endpoint configures Claude Code only and leaves omp's models alone.

## [0.63.0] — 2026-10-11
### Added
- **`8sync ccc` — Claude Code with named sessions.** `8sync ccc . <name>` create-or-resumes a Claude Code conversation by name in this repo: the name maps to a UUID that starts the session (`--session-id`, `--name`) and resumes it (`--resume`). Also `8sync ccc .` (last used), `. ls`, `. new`, `. rm` (removes the transcript too), `status`, and flags after the name go to `claude`. Installs Claude Code with Anthropic's official installer when missing.
- **The 8sync kit for Claude Code** (`8sync ccc kit`, run by `8sync setup`). It goes into `~/.claude`, so it applies to every repo:
  - 6 subagents (`explore` · `plan` · `task` · `quick-task` · `reviewer` · `designer`) and the `/ship` skill (explore → plan → implement → review → commit). Read-only agents use `disallowedTools` instead of a tool allow-list, so they keep the MCP code-intelligence tools.
  - **Verify hook**: after every Edit/Write, `8sync ccc hook verify` runs `cargo check`, the package's `typecheck` script (or `tsc --noEmit`) or `go vet` from the edited file's nearest manifest, and returns only failures to Claude. Native Rust, so no python3/jq/bash is needed, and it runs on Windows.
  - **Stop gate**: a Haiku prompt hook keeps the turn going while the last message shows unfinished work: planned steps not done, edits not verified, failing checks, `NOT MERGEABLE`, or a question it should have answered itself.
  - **Ask gate**: a Sonnet prompt hook on `AskUserQuestion` sends unnecessary questions back to Claude to decide. Questions about credentials, destructive or paid actions, and product decisions go through.
  - Auto permission mode and task tools on every model (both only when you have not set them), deny rules for `.env` reads and force-push, global rules in a managed block of `~/.claude/CLAUDE.md`, and omp's `codebase-memory-mcp` + `serena` registered in Claude Code.
  - Files you edited are kept (`--force` overwrites); settings are merged, never replaced.
- Stage A of `8sync setup` installs Claude Code + the kit (after `harness global`, so the MCP servers exist).
- The name → UUID registry is now shared by `8sync forge` and `8sync ccc` (`uuid_sessions.rs`).

### Fixed
- **Official installers on Windows launched from PowerShell 7.** Windows PowerShell 5.1 inherited pwsh's `PSModulePath`, lost `Get-FileHash`, and `claude.ai/install.ps1` failed. 8sync now clears that variable for every `powershell` child it starts.
- `8sync harness claude-code` overwrote `~/.claude/settings.json` and wrote lower-case `env` keys that Claude Code ignores. It now merges the upper-case `ANTHROPIC_*` keys into the existing file.

## [0.62.0] — 2026-10-11
### Added
- **Pro zsh for `8sync forge` and everyday use** (`assets/configs/zsh/8sync.zsh`):
  - Two-line prompt: repo-relative path, branch read straight from `.git/HEAD` (no `git` process per prompt), session name, Forge's agent · tokens · model segment, last-command duration (≥ 2 s), `❯` green/red by exit status. The Forge segment renders asynchronously (`zle -F`) and refreshes only after a Forge command, on resize, or every 30 s, so the prompt never waits for `forge`. Before this it sat in a right prompt that clipped in narrow panes (`claude-opus-5-5 ME…`).
  - Arrow-key completion menu: case-insensitive and fuzzy on `._-`, grouped, cached; the dump is rebuilt at most daily.
  - ↑/↓ history search by prefix; Windows Terminal/xterm Home, End, Delete and Ctrl/Alt word keys; window title set to `dir · forge:<session>`.
  - Pinned **zsh-autosuggestions v0.7.1** and **zsh-syntax-highlighting 0.8.0**, shallow-cloned and checked against their commits; Forge's `:command` / `@[file]` highlight rules stay.
  - Measured in a ConPTY on Windows: about 0.3 s from `8sync forge core` to a prompt (was 3.4 s), about 0.2 s per command.
- **`8sync setup --profile terminal` works on every OS:**
  - Windows: helix + JetBrainsMono Nerd Font via winget; the installed Nerd face becomes the Windows Terminal default only when none is set (targeted insert, re-parsed before writing).
  - macOS: brew helix + Nerd font cask.
  - Debian/Ubuntu: helix 25.07.1 release tarball, sha256-pinned, into `~/.local/share/8sync/helix`.
  - Arch/Fedora: native packages + kitty glass, as before.
  - Every OS: helix config if absent + the pro zsh. On Linux/macOS it is wired into `~/.zshrc` as one managed block.
  - Before this, every OS other than Arch/Fedora printed "Stage B profiles need pacman or dnf".
- **README rewritten**: Rust-core harness, one-line install table, the official Anthropic API path for Claude, the Forge shell.

### Fixed
- **zsh without sudo on Linux/macOS.** When zsh is missing and root needs a password, setup installs romkatv/zsh-bin's static zsh 5.8 (sha256-pinned per platform, relocated) into `~/.local/share/8sync/zsh`. The unattended `curl | sh` used to fail the Forge step on Ubuntu.
- **PATH bootstrap on Windows.** `~/.zshrc` / `~/.bashrc` got `C:\Users\…` entries whose `:` split PATH into junk in Git Bash and MSYS zsh. The block now uses `$HOME/…`, and existing blocks are rewritten in place.
- `8sync forge` writes its zsh files only when they change, and regenerates Forge's plugin/theme only when the forge binary changes (they were 150 ms of every launch). `compinit` now runs before Forge's plugin, which ends with `compdef`.
- Forge's per-command `$(date +%s)` fork is replaced with `$EPOCHSECONDS`, and autosuggestions run synchronously (async forks per keystroke). Each fork costs 10–25 ms on Windows.

## [0.61.3] — 2026-10-11
### Fixed
- **`8sync setup` installs gh on Debian, Ubuntu and other Linux without a native gh route.** Those distros
  only got "install `gh` manually" — not even counted as a failed step — so the one-line installer left
  Ubuntu members without gh (`8sync ship` needs it). Stage A now fetches the official
  `gh_<ver>_linux_<amd64|arm64>.tar.gz` from `cli/cli`'s latest release, checks it against the release's
  `checksums.txt`, and installs `~/.local/bin/gh` — no sudo, no apt repo.

## [0.61.2] — 2026-10-11
### Fixed
- **`8sync up` verifies checksums on Windows.** The install target came from `canonicalize`, i.e.
  `\\?\C:\…`; Git's MSYS `sha256sum` mangles that form into a missing file, and the failure was reported
  as "no sha256sum, shasum or certutil on PATH" — every Windows self-update ran unverified. The drive form
  is now unwrapped, and the hashers are tried in turn until one works.
- `8sync --help` described `up` as "8sync + omp + system pkgs + rustup + flatpak"; it updates 8sync only.

## [0.61.1] — 2026-10-11
### Fixed
- **Update check throttles on Windows.** The 6-hour window was the mtime of an empty `last_check` file;
  rewriting an empty file with `""` leaves the NTFS mtime alone, so every 8sync command in a terminal
  spawned a probe against the GitHub API (60 req/h unauthenticated). The stamp is now epoch seconds in
  the file's content; legacy empty markers, garbage and future stamps count as due.
- **`install.ps1` upgrades a running 8sync.** `Move-Item -Force` cannot replace a live `.exe` (any open
  `8sync . <session>`), so re-running the one-liner died with "Cannot create a file when that file
  already exists" and left a `.8sync.new.*` behind. The live binary is now renamed to `.8sync.old.<pid>`
  first (restored on failure, swept on the next install) — the same dance as `8sync up`.
- **`install.ps1` checksum no longer silently skipped.** Windows PowerShell launched from pwsh 7 inherits
  pwsh's `PSModulePath`, loads the wrong `Microsoft.PowerShell.Utility`, and loses `Get-FileHash`; the
  installer then printed "checksum: skipped". SHA-256 now comes from .NET directly.

## [0.61.0] — 2026-10-11
### Added
- **`8sync codex-web [up|status|wire|off]` — bridge ChatGPT Web (incl. Pro) into omp CLI.**
  Opens the [miuuyy/codex-chatgpt-web](https://github.com/miuuyy/codex-chatgpt-web) launcher so YOU
  log into ChatGPT (never logs in for you), polls the local loopback Responses server on `:17841`,
  auto-detects `/v1/models`, and wires an **isolated** `chatgpt-web` provider (`api: openai-responses`)
  into `~/.omp/agent/models.yml` — never touching native `anthropic`/`openai`, no global env var, no
  secret copied.
  `up` = launch the installed **production** Codex Web GPT app (the only build that serves omp; prints
  the one-line installer if missing) + wait-for-login + auto-wire; bare/`status` = probe + auto-wire if
  ready; `wire` = force re-detect; `off` = remove the provider. `--dir`/`CODEX_WEB_DIR` opt into the
  source `bun run app` launcher — a **DEV harness that CANNOT serve omp** (`purpose: "dev-harness"` is
  hard-blocked in `server.ts`), for tool development only. Loopback-only; ChatGPT web automation carries
  the upstream project's inherent account risk.
- **`8sync gen-img <prompt> [-o file.png]` — AI Image Generation via `gpt-image-2`.**
  Generates logos, icons, diagrams, UI mockups, and illustrations via `gpt-image-2`
  (OpenAI Images API via `https://api.apikey.fun/v1/images/generations`). Resolves API key
  from `--key`, `OPENAI_API_KEY`, or `~/.omp/agent/models.yml`. Decodes base64 or downloads
  image URL directly.
- **`image-gen` bundled skill (28th skill).** Teaches agents when and how to generate images,
  mockups, and visual assets, with prompt engineering best practices and immediate VLM inspection.
- **Standalone image generation scripts:** `scripts/gen-img.ps1` (PowerShell) and `scripts/gen-img.sh` (Bash).
- **Codex & OpenAI provider auto-configuration in `models.yml`:** Registered `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- **`8sync feynman [name|ls|rm|new|auth-omp|status|off]` — named session management for Feynman research agent.**
  Brings `8sync . <name>` parity to Feynman (`companion-inc/feynman`): `8sync feynman <name>` (e.g. `8sync feynman core`)
  creates or resumes an isolated named research session in the current project via `feynman --cwd <root> --session-dir <dir>`,
  tracked in `~/.config/8sync/feynman-sessions/<project-key>/index.json`. Supports `ls` (list project sessions with last active
  time), `rm <name>` (clean up session and directory), and `new <name>`. Every launch synchronizes omp's available chat catalog, including configured API-key providers.
- **`8sync forge <name> [--tui]` (alias `forgecode`) — named ForgeCode sessions, zsh-native by default.**
  `8sync forge core` opens an interactive zsh with Forge's own zsh plugin bound to the session's
  conversation: `: <prompt>` asks Forge, `:<Tab>` lists Forge commands, everything else is a normal
  terminal. `--tui` opens Forge's TUI on the same conversation; `-p "…"` is a one-shot. Names map to
  the UUID conversation ids Forge requires, per project (`<config>/8sync/forge-sessions/<key>/index.json`);
  `ls`, `new`, `rm`, `status`, `key [provider] <key>` (writes Forge's credential file — never `~/.env`,
  which Forge no longer reads) and `provider|config|workspace|mcp|info` passthrough. Forge is installed
  from its GitHub release when missing (`forgecode.dev/cli` currently 404s). Windows has no zsh: MSYS2's
  zsh 5.9.2 (pinned, sha256-verified) is unpacked with Windows' bsdtar into `%LOCALAPPDATA%\8sync\zsh`,
  reusing Git for Windows' runtime DLLs, terminfo, mount table and coreutils — no admin rights.
- **One-line installers now set up the whole harness.** `curl … /install | sh` and
  `irm … /install.ps1 | iex` run `8sync setup --no-profile` after installing the binary (opt out:
  `SUSYNC_NO_SETUP=1`). Under `curl | sh` setup reads the terminal (or `/dev/null`), never the script pipe.
### Changed
- **Setup Stage A = full AI harness on every OS:** gh, omp, codegraph, **forge + zsh**, configs, skills and
  **`harness global`** (every bundled skill, APPEND_SYSTEM, MCP, hooks). `--no-profile` now runs
  unattended (logged, a failed tool is reported and the rest still installs).
### Fixed
- **Windows Stage A no longer needs `sh`:** omp and codegraph install through their official
  `install.ps1` (`irm | iex`) instead of `sh -c "curl … | sh"`, which a stock PowerShell box lacks; tools
  that a fresh install put only on the user PATH are detected at their default locations.
- **Update notifications and `8sync up` survive GitHub API rate limits:** when `api.github.com` refuses
  (60 req/h per IP), the latest tag is resolved from the `releases/latest` redirect, as the installers do.
- **Checksums on Windows:** Git for Windows' `sha256sum` prefixes its output with `\` for backslash paths,
  so every Windows download was reported "checksum NOT VERIFIED"; the marker is now skipped.
- **`--no-default-features` builds again** (`8sync forge` no longer calls the `web`-gated project
  scaffolder — which also `git init`-ed any directory a session was opened in).
- **Size gate ceiling 5180 → 5300 KiB, with attribution** (`scripts/size-gate.sh`): v0.60.0 → v0.61.0 every
  asset grew by the same four new verbs/bridges (linux-x86_64 +102,656 B → 5,390,608 B; windows +123,392 B);
  `web` gate still +1,159,680 B. `scripts/size-report.sh` now finds `8sync.exe` on Windows hosts.
- **`8sync feynman <name>`: automatic authenticated model synchronization and native omp inference.**
  Replaces hardcoded Opus registration and copied OAuth tokens with managed `models.json` entries,
  live vault lookups and a Pi extension using `omp auth-gateway stdio`. Keeps Feynman's existing
  `/model` picker, tools and selected default; supports omp-native transports including Cursor.
  Synchronization and `off` preserve user-edited models, credentials and unrelated providers.
  Omit null/unknown model limits instead of invalidating Pi's whole catalog. On Windows, seed
  missing `shellPath` with real Git Bash; isolate Feynman's `PI_CODING_AGENT_DIR` from omp's
  vault while restoring any original user override for both key lookup and inference.
  Native stdio buffers each turn before returning its SSE events; output is not token-live.
  Verified 345 bridged models across 12 providers in actual Pi; real named-session `/model`
  selection and Opus 5.5 inference passed, as did native tool-call/result continuation.
- **Feynman Windows renderer crash:** repair the missing `truncateToWidth` import and reassigned
  `const line` on every launch. Actual differential-render smoke covers normal text, ANSI/Unicode
  overflow and intact image data; bundled versions with the intentional overflow guard remain unchanged.
- **`8sync feynman` (Windows): `/` was swallowed, so slash commands (`/model`, `/settings`) never opened.**
  Feynman's embedded Pi 0.62 key parser ignores modifiers it cannot detect, so pi-btw's default
  `super+/` focus shortcut matched a bare `/`. The launcher now patches that parser (both bundled
  `@mariozechner/pi-tui` copies) to reject unsupported modifiers. Verified via ConPTY: `/` opens the
  command menu and `/mod` filters to `model`; `ctrl+c`/`shift+tab` still match.
- **Local omp 18.8.3 Windows terminal hotfix:** preserve incomplete win32-input-mode
  packets across the 75 ms input timeout instead of inserting `ESC[8;14;8;…_`
  fragments into the composer. Reproducible upstream source/test patch:
  `scripts/omp-win32-record-framing.patch`; installed locally, not an upstream release.
  Verified all Backspace packet split positions with 500 ms delays, existing Escape,
  Enter, paste and modifier tests (23 passing), plus compiled-binary smoke test.
- **Session resume no longer clobbers active model with GLM:** `cfg.resume_flags()` previously emitted
  `--model <roles.default>`, which defaulted to `"glm"`. Whenever a user resumed a session with `8sync .`,
  `8sync . <name>`, or `8sync ai continue`, omp was invoked with `--model glm --continue`, forcibly overriding
  the session's active model (e.g. Claude Opus or Gemini Flash) to GLM. `resume_flags()` now omits `--model`,
  preserving the session's active model across resumes.
- **`8sync feynman` Windows process launch, `/model` switching, and OAuth/API-key bridge:**
  - **Preserved `google-antigravity` OAuth provider:** Previously mapped to `google`, causing all Gemini and Antigravity models (`claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gemini-3-flash`, `gemini-3.1-pro-high`) to fail or disappear. Now correctly mapped with full OAuth payload (`token`, `projectId`, `refreshToken`, `expiresAt`, `email`).
  - **Direct token resolution for API keys:** Replaced `!omp token <p> --raw` with pre-resolved keys in `auth.json`, eliminating Windows WSL bash 127 status traps where `resolveConfigValue` failed on Windows.
  - **Removed invalid legacy entries:** Purged invalid `google` (oauth) and `cursor` entries that broke model selection dialogs.
  - **Fixed broken default model on startup:** Automatically checks `settings.json` and resets failing default models (such as rate-limited `anthropic/claude-opus-4-6`) to verified available models (`google-antigravity/gemini-3-flash` or `zai/glm-5`).
  - **Direct Node runner on Windows:** Bypasses `cmd.exe /C` by invoking `node bin/feynman.js` directly with inherited stdio, avoiding quoting bugs and signal interception.
  - **CLI subcommand passthrough & flag support:** Supports `8sync feynman model [list|set]`, `8sync feynman doctor`, `8sync feynman setup`, and flags (`--model`, `--prompt`, `-h`) with `allow_hyphen_values`.
  - **Patched `pi-subagents` extension crash:** Guarded `selectedTools` access with optional chaining to prevent undefined property errors on turn startup.
## [0.60.0] — 2026-09-04
### Added
- **`8sync harness claude-code [JSON|FILE]` — one-command Claude Code settings & Anthropic models auto-setup.**
  Accepts the standard Claude Code settings JSON payload (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_ATTRIBUTION_HEADER`). Automatically writes
  `~/.claude/settings.json`, configures Windows User environment variables, updates `~/.omp/agent/models.yml`
  with the 9 current Claude models (`claude-opus-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-opus-4-8`,
  `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-haiku-4-5`) under
  both `anthropic` override and custom provider slug, configures `anthropic-budget-effort` thinking, sets
  `anthropic/claude-fable-5-1:high` as default role, and verifies connectivity with a live probe.
  Also available via standalone scripts: `scripts/setup-claude-key.ps1` and `scripts/setup-claude-key.sh`.

### Fixed
- **GLM-5.3 / GLM-5.3-Flash native vision.** These models read images in-session
  (`image_url`, https://docs.z.ai/guides/vlm/glm-5.3-flash). Always-on prompts
  (`APPEND_SYSTEM`, `image-routing`, `00-force-load`, recall hook) used to treat
  every Z.ai model as text-only GLM-5.2 and bounce pixels through the
  `zai-vision` MCP (`glm-4.6v-flash`). Agents now **look at the attached image**
  when the session is `zai/glm-5.3*`. `zai-vision` remains a **fallback for
  GLM-5.2 only** (STOP gate at the top of the skill). Alias `glm`/`zai` →
  `zai/glm-5.3-flash`; combo `claude+glm` keeps `modelRoles.vision` on the cheap
  native VLM instead of routing images to Opus. Cursor/AGENTS force-load now
  states the same gate (Cursor does not read `~/.omp/APPEND_SYSTEM.md`).

## [0.59.0] — 2026-08-25

### Added
- **`8sync harness create` — full multi-host bootstrap for Cursor + Z.ai Code + omp.** One command
  vendors `su-code/skills/`, then fans the same Agent Skills tree out to **`.cursor/skills/`**
  (Cursor's project skill path) and **`.zcode/skills/`** (Z.ai Code), plus a Cursor-native
  **`.cursor/rules/8sync-harness.mdc`** (`alwaysApply: true`) so a Cursor session loads the
  CORE contract without reading `~/.omp`. Host dirs are a relative symlink / Windows junction
  when the OS allows it, otherwise a copy. `create --sweep [DIR]` stamps every omp project
  (has `su-code/` or AGENTS.md) under DIR — default `~/Projects`, and on Windows also
  `<Users>/Projects` next to the home folder. Bare `8sync harness` / `init` / `global --sweep`
  now run the same host adapters, so existing projects pick this up on the next refresh.

## [0.58.0] — 2026-08-21

### Added
- **`super-pdf` bundled skill** — the HTML→PDF report engine (design system that produced
  the admired CloudGO review/architecture PDFs) is now self-contained in su-code: annotated
  `references/report-template.html` (kicker cover + meta table + tagbox, §N section spine,
  navy comparison tables with pills, 4 callout variants, stat cards, 3-zone running footer
  with page numbers) + `scripts/build.sh` (WeasyPrint via `uv run`, page-count guard) +
  content rules (§0 = verdict first, every number traces to a source). Every machine gets
  it after `8sync setup`; previously the engine only lived inside `agentic-cloudgo-v1`
  project skills while the `repo-md2pdf-git-report` managed skill pointed at a deleted
  tool path.
  Renamed from the in-session `report-pdf` draft before release. Also adds an optional
  cover `.chips` strip (category chips, as on the architecture-PDF variant).

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync omp update` could hang forever and repaired via the wrong channel.** omp's
  self-updater downloads a ~185 MB standalone binary with no progress output and no timeout
  of its own; the verb ran it with `Command::output()` (silent, unbounded), and its repair
  path reinstalled via `npm install -g` for an EEXIST scenario that no longer matches the
  omp.sh standalone layout. Now: the update attempt is time-boxed (10 min) with a 60 s
  heartbeat, interrupted-update `~/.local/bin/omp.*.new` partials (up to ~185 MB each) are
  swept, and repair reinstalls via the official `omp.sh/install --binary` (same channel as
  `8sync setup`, stall-protected + smoke-tested), with binary backup/restore insurance.
- **Retired omp extensions hard-fail loading since omp 17.4 (zod v4).** Stale copies of the
  old engine — the multi-file `8sync-gs/` and the `ckit-engine.ts` / `ckit-workflow.ts`
  interim renames — use `.default([])` array-literal zod defaults, which omp 17.4's bundled
  zod v4 rejects at load ("ParseError: A mutable default value must be specified as a
  factory"), spamming a warning and silently dropping those tools in every project still
  carrying a copy. `ensure_engine`'s sweep (formerly workflow-only) now also removes
  `8sync-gs/` and the `ckit-*` renames from the global and project extension dirs on every
  `8sync harness` / `harness up`. `ckit-*` removal is content-gated on the
  `8sync-engine`/`8sync-workflow` lineage marker so a user's own same-named file survives.

## [0.57.0] — 2026-08-14

### Added
- **`sx-plan` command**: Autonomous plan-review gate for deep research, slice decomposition, and task-reviewer contract verification using `engine_plan`, `task`, and `recall`.
- **`sx-sync-pr` command hardened**: Existence guards, branch validation gate, SHA-based main up-to-date checks, and non-push default safety.
- **4 Foundation Reference Skills**: Added `tauri-v2`, `nextjs-app`, `encore-eino-go`, and `ai-microservice-design` with `locked: true` frontmatter, grounded in real 8syncdev production repos. Registered as foundation skills in `AGENTS.md` and committed under `assets/skills/`.
- **Default Boot Kernel Enforcement**: Configured `grubby` to set `/boot/vmlinuz-6.19.10-300.fc44.x86_64` as default boot kernel, restoring native Fedora Bluetooth support (`btusb`), 180Hz display rate, and official NVIDIA RTX 5080 driver persistence across reboots.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync .` and `8sync ai` could not launch omp at all.** STEP-0 steered omp with
  `--tools`, which is an ALLOWLIST — so 8sync had to name every built-in tool omp has, and
  omp 17.3 renaming `ast_grep` and dropping `github`/`checkpoint`/`rewind`/`security_scan`
  made every launch die on the spot with `CliUsageError: Unknown tools in --tools`. The
  failure looked like a session bug rather than a flag bug: `8sync . core` printed
  `→ resume session 'core'`, omp exited before drawing a frame, and the user fell back to a
  bare `omp --continue` — which reads omp's *default* per-cwd store, not the named session's,
  so the session they had just opened appeared to have vanished.
  STEP-0 is now a DENY-list: 8sync writes `grep.enabled: false` + `glob.enabled: false` to a
  managed overlay (`~/.config/8sync/omp-step0.yml`) and passes it as `--config`. It names only
  the two tools that must go, so no omp release can brick a launch or silently disable a tool
  again, and MCP/xdev tools are untouched. Per-launch, so `--no-step0` and the user's own bare
  `omp` still get the searchers. omp's accepted-tool set turned out to be assembled
  asynchronously and to differ between runs of the same binary, so the old
  "mirror omp's list, probe for drift" approach could never have been made correct.
- **`8sync doctor` checks that STEP-0 still bites, not that a list still matches.** It asks omp
  to accept `--tools grep,glob` under the overlay and expects a rejection; the answer is now
  a property of the running omp rather than of a constant in this repo.
- **A named session now prints the omp command that reopens it** (`omp --session-dir … --continue`),
  because a named session deliberately lives in its own store and a bare `omp --continue` will
  never find it.
- **The four foundation skills shipped in v0.56.0 were never deployed.** `tauri-v2`, `nextjs-app`,
  `encore-eino-go` and `ai-microservice-design` were embedded in the binary and listed in
  `AGENTS.md` but missing from `BUNDLED_SKILLS`, so `8sync harness` never wrote them to
  `~/.omp/skills/`. The registry test caught it; they are registered now.
- **The STEP-0 overlay is written atomically.** `fs::write` truncates before it writes, so a
  second `8sync` starting concurrently — or omp itself, reading the `--config` it was just
  handed — could observe an empty file and hard-error on it. The overlay now lands via a
  staged sibling plus `rename`, so every reader sees one whole version or the other. The stage
  name carries a per-call sequence, not just the pid: two threads in one process would otherwise
  choose the same sibling and the one that renamed second would fail on a file already moved
  away, silently dropping STEP-0 for that launch. Both directions were found by the release CI
  (Windows read `""`, then Linux hit the collision) and are now covered by a concurrency test.

## [0.56.0] - 2026-08-09

### Added
- **`8sync lcd` — Lian Li fan/AIO screens from the shell.** `8sync lcd` lists every screen the
  `lian-li-linux` daemon can see, `8sync lcd photo.png` (or `.gif` / `.mp4` / `#ff0055` / `off`)
  draws on all of them, `--device` targets one by index or id, `8sync lcd bright 60` sets
  brightness. It speaks the daemon's own newline-JSON IPC on
  `$XDG_RUNTIME_DIR/lianli-daemon.sock` instead of re-implementing the USB protocol, so the
  setting lands in the daemon's config and survives a reboot — and none of it needs the GUI.
  `SetLcdMedia.device_id` is sent as `serial:<id>` because upstream matches the request against
  `LcdConfig::device_id()`; any other spelling appends a duplicate entry rather than replacing the
  screen's existing one. Verified on 8× UNI FAN TL V2 LCD (400x400): colour, image and
  single-screen targeting all confirmed in the daemon's own log.
- **`8sync lcd gui` launches the upstream GUI with the fix already applied.** `lianli-gui` is
  Tauri/WebKitGTK and its DMA-BUF renderer dies with `Error 71 (Protocol error) dispatching to
  Wayland display` on a machine whose GPU path is degraded (here: an RTX 5080 on `nouveau`) — the
  window simply never appears. The verb sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which costs
  nothing visible and is the difference between an app that starts and one that does not.
- **`8sync hz` — refresh-rate manager.** `8sync hz` reports every output's current rate against
  the highest one available, `8sync hz max` raises each to its ceiling, `8sync hz 144` picks a
  specific rate; `--output` narrows to one connector and `--dry-run` prints the backend call.
  Resolution is never changed — only the refresh field of the mode already in use — because the
  fastest mode a monitor offers is routinely a *smaller* one (this dev box lists 2560x1440@144
  while running 3440x1440@100), and "faster" must never mean "smaller".
  Backends: GNOME/Mutter over `busctl` (Wayland *and* X11 — the only supported way to set a mode
  under GNOME Wayland), Hyprland `hyprctl`, KDE `kscreen-doctor`, and X11 `xrandr`. Mutter applies
  are `VERIFY`-ed before they are made persistent, and the full logical-monitor layout (position,
  scale, rotation, primary) is echoed back untouched, because `ApplyMonitorsConfig` replaces the
  *whole* layout and silently resets anything omitted. Backends that cannot persist a change say
  so and print the config line that would.
- **`8sync hz` diagnoses a capped panel instead of accepting it.** The verb parses the display's
  own EDID range-limits descriptor and compares the panel's ceiling with what the driver exposes.
  A 180 Hz monitor pinned to 100 Hz is not a compositor setting: the kernel filters out every mode
  above the negotiated DisplayPort link bandwidth, so the fast mode is gone before GNOME ever sees
  it. When the gap is real, `hz` names the bound driver, explains it, and prints the fix — on an
  NVIDIA card still on `nouveau` that is `8sync setup --profile nvidia`, worded per distro family
  (RPM Fusion `akmod-nvidia` on Fedora, `nvidia-open-dkms` on Arch). `8sync doctor` carries the
  same check as a one-liner. Distro-agnostic: no package manager is involved in reading or setting
  a mode, so Fedora and Arch behave identically.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **Upgrading no longer leaves duplicate slash commands.** v0.55.0 removed the pre-prefix copy of a
  command only when it was byte-identical to the asset in the *current* build — but that same
  release rewrote every command body to self-reference the new prefixed name, so the compare could
  never match and every upgraded machine kept both `/auto` and `/sx-auto` (eight stale pairs,
  frozen at v0.54.1). The gate now recognises any body 8sync has ever shipped, from a frozen table
  of digests that by construction can never grow. A command the user wrote at one of those names is
  still never touched.

## [0.55.0] - 2026-08-09

### Added
- **`/sx-super-dev`** — one command for the whole lifecycle: ground → research (feynman/web) →
  plan → parallel build → adversarial review (reviewer + security-reviewer, fresh context) → deep
  UAT that role-plays a real user with browser capture and a clean-environment CLI run → ship →
  CI/CD and **published-artifact** verification. Distilled from the v0.54.x release, including the
  traps it hit: a tag that disagrees with the manifest, a "non-blocking" background thread the
  runtime kills at exit, and reviewers finding release-breaking defects the author could not see.
  Its governing rule is that the author's own "done" is never the evidence.

### Changed
- **Every slash command now deploys under an `sx-` prefix** (`/sx-auto`, `/sx-feature`, …).
  omp merges commands from every tool into one flat namespace shared with the user's own, so an
  unprefixed `/auto` was unattributable and collided with any other tool shipping the same obvious
  name. The prefix comes from `brand::CMD_PREFIX`, so a rebranded build picks its own; assets stay
  bare and are prefixed at deploy time. omp registers a command by FILENAME, so the frontmatter
  `name:` was realigned to the invoked name, and `8sync skill new --command` scaffolds it that way.
- Upgrades remove the pre-prefix copy of a command, but ONLY when it is byte-identical to the asset
  we shipped — a same-named command the user wrote is never touched.

## [0.54.1] - 2026-08-09

### Security
- **`8sync up` now verifies the downloaded binary.** `install.sh` checked the release asset's
  sha256 `digest` from the GitHub API, but the recurring path the update notice steers everyone
  toward — `8sync up`, including `--to <tag>` — curled the asset and renamed it into place
  unverified. It now checks the same digest with the same semantics, deletes the temp file and
  refuses to install on a mismatch (naming expected vs actual), and never leaves an executable
  behind. When no digest is published or no `sha256sum`/`shasum`/`certutil` is on PATH it still
  upgrades — aborting would strand minimal images — but says `checksum NOT VERIFIED` out loud
  instead of looking verified. Both curl calls also gained `--proto '=https' --tlsv1.2`.

## [0.54.0] - 2026-08-09

### Security
- **Command injection in the shipped `8sync-engine.ts`.** `engine_advance` built
  `git commit -m <msg>` as a string for `bash -lc`; `JSON.stringify` escapes `"` and `\` but a
  double-quoted bash word still performs command substitution, and the message is a model-supplied
  parameter routinely paraphrased from files the agent just read. Git and gitleaks now run through
  an argv-based `runArgv` with no shell. Shell evaluation is retained only for a task's `verify`
  commands, where it is the documented contract.
- **Argument injection into `sudo pacman` / `sudo dnf`.** Profile package lists were spliced into a
  privileged argv with no end-of-options separator, so an entry beginning with `-` became a flag —
  `--hookdir=` hands alpm attacker-written root hooks, `--setopt=reposdir=` repoints dnf. Package
  names starting with `-` are now refused outright at all three privileged entry points, and the
  planners emit `--` before the package list.
- The autonomous-commit gitleaks gate no longer fails open silently: `if command -v gitleaks` exits
  0 when gitleaks is absent, so fresh machines got unscanned commits from a gate that claimed to
  scan. Presence is probed separately and an unscanned commit says so.

### Fixed — profiles a teammate never asked for
- **`--full`/`--yall`/`-y` applied the maintainer's personal `alexdev` bundle**, so a teammate
  running "install everything" got Lian Li chassis drivers, a Vietnamese IME, DisplayLink DKMS and
  Bitwarden. `--full` now means every **community** profile, read from the same
  `offered_profiles()` the y/N prompt uses. Personal profiles are reachable only via
  `--profile <name>`; `--profile alexdev` restores the old behaviour in one flag.
- `--full` also skips the `warp` VPN: a flag meaning "don't ask me" is the wrong way to acquire
  something that rewrites DNS and routing, and `--community` already documented that opt-out.
- **Profiles installed packages for hardware the machine does not have.** `apply` installs packages
  before `post_install`, so the nvidia profile's own "no NVIDIA GPU detected" guard ran far too
  late. New `requires.detect` probe is evaluated in `resolve`, per bundle member, before any
  package work; `nvidia` probes sysfs PCI vendor `0x10de` (no `lspci` dependency) and fails closed.
- A profile skipped for missing hardware is no longer recorded as applied.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- Line endings are now pinned to LF by `.gitattributes`. 14 embedded assets (a skill and the
  impeccable keyword rules) had CRLF committed, so the binary shipped assets whose bytes differed
  from every other asset — defeating the byte-compare that keeps user-edited files untouched and
  omp's prompt-cache prefix stable, and breaking frontmatter matching that keys on `\n`. A Windows
  checkout would have baked CRLF into every asset; the new CI `Test` step caught it.
- `Cargo.toml` version now matches the release tag, enforced by a new CI gate. Shipping 0.53.0
  under a v0.54.0 tag would have told every up-to-date user "update available" forever and made
  `8sync up` re-download the binary on every run.
- **A stale `8sync-workflow.ts` kept loading after upgrade.** The extension was retired this
  release, but nothing deleted the copy an earlier 8sync had already written to
  `~/.omp/agent/extensions/` and `<root>/.omp/extensions/`, so omp went on registering its tools
  next to the engine's. `8sync harness` (any subcommand) now removes both copies; the retired
  deploy path and its six call sites are gone.
- **Two shipped skills never deployed.** `research-paper` and `remote-compute` were added to
  `assets/skills/` but never registered in the deploy list, so `~/.omp/skills/<name>/` was never
  created on any machine — while `00-force-load.md` told the agent to open those SKILL.md files.
  Both are registered now, and a new guard test walks the embedded assets in the opposite
  direction (asset → list) so an unregistered skill dir fails the build by name; `social-growth`
  stays the single documented opt-in exception.
- **The shipped skill registry pointed at a deleted asset dir.** `assets/configs/skills.toml`
  (deployed to `~/.config/8sync/skills.toml`) still declared `src = "builtin:karpathy"` after the
  rename to `karpathy-guidelines`, so `8sync skill update` warned and skipped it on every run.
- **User-facing docs advertised 15 skills that no longer ship.** `README.md`, `AGENTS.md` and the
  docs site claimed "37 skills bundled" (and, elsewhere, 17) and named `literature-review`,
  `autoresearch` and `paper-writing` among "18 research skills" — all three directories were
  deleted, and the research set is now `deep-research`, `research-paper`, `remote-compute`. Every
  count now reads 23, matching `assets/skills/*/SKILL.md`, every named skill resolves to a real
  directory, and the two-tier force-load order (4 CORE + 6 specialist always-on) is described as
  `00-force-load.md` actually implements it. The docs site also told users to run
  `8sync skill add builtin:karpathy`, which no longer resolves.

### Added — Fedora-first package core (8sync now works on Fedora/RHEL)
- `trait PkgBackend` with `Pacman` + `Dnf` impls, selected by `env_detect::distro_family()`
  (`Family::{Arch,Fedora,Other}`, reads `ID` **and** `ID_LIKE`; Fedora 44 ships no `ID_LIKE`, so
  `ID` alone resolves). `backend()` returns `Option`, so a distro with neither manager keeps
  today's warn-and-continue instead of failing — Debian/openSUSE users are unaffected.
- Every package-manager spawn now lives **only** in `pkg.rs`. `platform::install_core_pkg` takes a
  `CorePkg { arch, fedora, brew, winget }` instead of positional strings nobody could tell apart.
- Profiles gained an **additive** `[packages.fedora]` table (`dnf`/`copr`/`rpmfusion`/`swap`)
  beside the existing `pacman`/`aur`/`aur_yay` keys, plus `#[serde(deny_unknown_fields)]`. All 37
  Fedora package names were verified against the live repos with `dnf repoquery`; profiles with no
  real rpm equivalent declare none and are skipped with a printed reason rather than guessing.
- `vpn` and `harness browser` are no longer Arch-only (Cloudflare WARP / `chromium` on Fedora);
  `clean` gained a dnf arm (`dnf clean all`, `dnf autoremove`).
- COPR is treated as third-party root code: `copr_enable` refuses any `owner/project` outside a
  checked-in allowlist unless explicitly allowed, and `dnf swap --allowerasing` prints the erase
  set first.

### Changed
- **Size ceiling recalibrated `5 MiB` → `5 180 KiB` (5,304,320 B), attribution-first.** The
  ratchet headroom was 4,208 B at v0.57.0; v0.56+v0.57 feature growth had eaten it all,
  so this release`s legitimate +20,608 B (omp hardening + sweep + super-pdf) tripped the
  gate. `size-report.sh` attribution: the `web` feature gate alone = +1,732,232 B — the
  only elephant. Ceiling stays tight on purpose: the next feature release trips it again
  and must attribute again. `AGENTS.md` §8 numbers refreshed (CI musl sizes).

### Fixed
- **`8sync setup` aborted at step 3 of 8 on every non-Arch Linux.** The AUR-helper step was gated
  on `Os::Linux` instead of the Arch family, so on Fedora it failed and `try_step`'s `?`
  propagated — `codegraph`, `path-bootstrap`, `configs`, `skills` and `codegraph-skill` never ran.
  This is why `~/.omp/skills` was empty on Fedora machines.
- **Skill paths written into `AGENTS.md` were absolute to the authoring machine**
  (`/home/alexdev/...`, `/home/alexng/...`), so on any other clone omp was told to read files that
  do not exist and silently skipped the skills. `skill/inject.rs` now emits repo-relative paths for
  project skills and `~/`-anchored paths for global ones. `harness audit` could never catch this
  because it skipped every `/`-prefixed token; it now flags `/home/`, `/Users/`, `/root/` while
  still ignoring `/etc`, `/usr`, `/tmp`.
- `Dnf::install` left a half-applied batch: its plan can hold two transactions (install, then
  upgrade), and a failed upgrade returned `Err` while the committed install stayed. It now reverts
  via `dnf history undo`.
- `install.sh` created its temp file in `/tmp` (tmpfs) while installing to `~/.local/bin` (btrfs),
  so the "atomic" `mv` crossed filesystems and degraded to a copy. The temp file is now a sibling
  of the destination, matching `selfup.rs`.
- `install.ps1` hardcoded the x86_64 asset, silently giving Windows ARM64 the wrong binary.

### Changed — enforced tool routing (omp stops ignoring the code-intel stack)
- Preferring codegraph/serena/codebase-memory was previously **prose**, which omp ignores under
  load. It is now enforced by mechanisms omp implements in code: a TTSR rule
  (`condition` + `scope: "tool:grep(*), tool:glob(*)"` + `interruptMode: tool-only`) that aborts the
  stream mid-tool-call, plus `bashInterceptor` patterns closing the `bash rg` escape.
- Both are **capability-gated**: with no code-intel tool installed the rule and the interceptor
  block are removed, so a bare machine is never dead-ended. TTSR `repeatMode: once` means the worst
  case is one restarted turn, not a hard veto.
- `APPEND_SYSTEM.md` shrank 9 198 → 3 260 B (−64.6 %); it is in every prompt on every turn, and the
  TTSR rule body costs zero prompt tokens.
- Downloads are now sha256-verified using the `digest` field the GitHub Releases API already
  returns — no new dependency, no release-plumbing change.
- First tests in the repo: 48 passing (`cargo test`), covering distro parsing, the pacman argv
  regression fixture, the COPR allowlist refusal, path portability, and audit path classification.

## [0.53.0] — 2026-08-08

### Added — `8sync .` named per-project sessions (run many features at once)
- `8sync .` grew a session layer so you can keep several concurrent lines of work in one repo,
  each an isolated omp conversation. Surface (namespaced under `.`, no new top-level verbs):
  `8sync . <name>` create-or-resume · `8sync . new <name> [--worktree]` · `8sync . ls`/`--list`
  (`--json`) · `8sync . mv <old> <new>` · `8sync . rm <name> [--force]` · `8sync . merge <name>...
  [--keep-worktree]`. `8sync .` with no name resumes the last-used session (omp's default store
  when none was ever named — unchanged legacy behavior).
- Mechanism (a thin layer over omp's existing session core — not a reinvention): one omp
  `--session-dir` per name (omp's own `--continue` resumes it — zero session-id bookkeeping),
  tracked in a machine-local registry `~/.config/8sync/sessions/<repo>/index.json` that stores
  only what omp lacks (human name, worktree binding, last-used). Every launch reuses `ModelConfig`
  so STEP-0 tool-routing + advisor survive.
- `--worktree` gives a session its own `git worktree add -b 8sync/<name>` so two features edit the
  same files concurrently without collision; `ls` shows branch + dirty state.
- `merge <name>...` lands session branches into the current branch, ECC-style (affaan-m/ECC, MIT):
  read-only `git merge-tree --write-tree` conflict preflight → `git merge --no-edit` → rebase the
  conflicting worktree onto the target to unblock (auto-abort + skip on true conflict) → clean up
  merged worktree + branch + session (`--keep-worktree` to preserve). Sequential, so branch-vs-branch
  conflicts surface as the target advances. Local-only — never pushes.
- Everything runs through `git`/`omp` shell-out — **no new dependencies** (ECC's rusqlite/git2/tokio
  stack was deliberately not adopted; it would bust the size budget). `8sync doctor` reports session
  count + dirty worktrees. New module `crates/cli/src/verbs/session.rs`; `here.rs` dispatches.
- Evaluated but NOT integrated (user asked to review): linshenkx/prompt-optimizer (AGPL-3.0 +
  optimizes human prose — wrong layer) and TypeScript 7 / typescript-go (transparent to `8sync run`,
  no code change).

### Fixed — `8sync up` was Linux-only and bricked itself on Windows
- Symptom (Windows): running `8sync up` left an un-runnable file so the next `8sync` invocation popped Windows' *"Select an app to open '8sync'"* picker instead of executing. Root cause in `crates/cli/src/verbs/selfup.rs`: the self-updater hard-coded `ASSET_SUFFIX = "-linux-x86_64"` (downloaded the **Linux** binary), wrote it to `~/.local/bin/8sync` with **no `.exe`**, and replaced it with a plain `std::fs::rename` (which Windows forbids on a running `.exe`). The release CI already publishes `8sync-<tag>-windows-x86_64.exe` and `install.ps1` installs to `%LOCALAPPDATA%\Programs\8sync\8sync.exe`, so the updater was simply never taught about non-Linux.
- Fix — self-update is now genuinely cross-platform:
  - **Correct asset per OS/arch:** `asset_label()` maps `platform::os()` + `std::env::consts::ARCH` to the CI labels (`linux-x86_64`, `linux-aarch64`, `darwin-x86_64`, `darwin-arm64`, `windows-x86_64`; macOS ARM is `arm64`, not `aarch64`), and `asset_filename()` appends `.exe` on Windows. Both `fetch_latest_release` (auto-check + `8sync up`) and `install_tag` (`8sync up --to`) use it.
  - **Install to the running exe** via `dest_path()` = `std::env::current_exe()` (canonicalized), so `8sync up` replaces 8sync wherever it actually lives — the Unix `~/.local/bin/8sync` OR the Windows `…\Programs\8sync\8sync.exe` — instead of a hard-coded Unix path. Falls back to the legacy path only if the current exe can't be resolved.
  - **Windows-safe replace:** `download_and_replace()` renames the live `.exe` aside to `.8sync.old.<pid>` (allowed while running) before sliding the new binary in, restoring the original if the install fails; stale `.old` files are swept on the next run. Unix keeps the same-dir inode-swap rename.
- Verified: native Linux release build is clean; the `#[cfg(windows)]` branch type-checks (it uses only cross-platform `std::fs` APIs — confirmed by compiling it with the gate temporarily forced on).

### Fixed — serena's web dashboard opened a browser tab on every session start
- Symptom: a Serena dashboard tab kept reappearing (showing `Error loading configuration` / `Error loading stats`, since it races the server it is reporting on), and RAM climbed. Cause: serena ships `web_dashboard: true` **and** `web_dashboard_open_on_launch: true`, so every `start-mcp-server` binds an HTTP dashboard and pops a browser tab. omp spawns one serena per session, so this multiplies — measured here: **16 live serena processes holding 878 MB**, one dashboard each.
- Fix: `deploy::ensure_serena_mcp` now registers serena with `--enable-web-dashboard False`. The flag is passed on the **command line** rather than by editing `~/.serena/serena_config.yml`, because serena owns that file and rewrites it — a config edit alone does not survive. `register_omp_mcp`'s self-heal rewrites the existing `mcp.json` entry in place, so the fix lands on `8sync harness global` with no manual step.
- The dashboard is pure observability: serena's MCP tools are unaffected. Verified live — no listener on `24282`, and `mcp__serena_get_current_config` still answers.
- Note (not a leak): a serena pair (`uv` wrapper + python child ≈ 145 MB) is held per **live omp session**, not per project. Closing unused omp sessions is what reclaims that memory.

### Added — STEP-0 tool-routing ENFORCEMENT (`step0`): the rule is now code, not prose
- Measured problem (this machine, `8sync harness toolstats`): the STEP-0 MCP stack was connected and callable yet effectively unused — `cbm 0 · serena 0 · headroom 0` agent calls; every code lookup fell back to the built-in `read`/`grep`. Prose directives in `APPEND_SYSTEM.md`/AGENTS.md had failed to change behaviour three times (see KNOWLEDGE). Zero-friction built-ins always beat an instruction.
- **Fix — remove the fallback instead of asking nicely.** `8sync ai` / `8sync .` now launch omp with `--tools` DROPping the two redundant searchers `grep` + `glob` (`STEP0_TOOLS` in `crates/cli/src/models.rs`), so code lookup MUST flow through codegraph (CLI) · codebase-memory-mcp · serena. `--tools` is an **allowlist** (omp has no deny-list — `tools.blocked` is only a telemetry counter), so it must name every tool to keep: anything omitted is silently disabled. The list is omp's validator list minus `grep`/`glob`, and minus `computer` to preserve its default-disabled state. `lsp` is deliberately KEPT (zero-friction; serena needs `activate_project` per session). MCP/xdev tools are orthogonal to `--tools` and survive it.
- **Shell escape closed:** `deploy::ensure_bash_interceptor` writes `bashInterceptor.patterns` into `~/.omp/agent/config.yml`. omp's rule shape is `{ pattern, tool, message }`, and its matcher **skips any rule whose `tool` is not in the session's tool list** — so a rule pointing at `grep`/`glob` disables itself precisely because STEP-0 removed them. Every rule therefore points at `lsp` (always present, and the honest suggestion). Blocks `rg`/`ag`/`ack`, `grep -r`, and `find -name`; single-file and log `grep` stay allowed. Setting the key replaces omp's default array. Wired into both `global_pass` and `harness_init`.
- **Verified end-to-end on omp 17.2.9** (the previous iteration was verified only as "the string is embedded in the binary", which is why it shipped broken): the captured provider request carries 18 tools with `grep`/`glob` **absent** and `recall`/`retain`/`reflect`/`memory_edit`/`hub`/`eval`/`ast_edit`/`lsp` **present**; `8sync ai` returns normally; `rg main main.rs` is refused with `Blocked: STEP-0: …`; `grep -r main .` is refused; plain `grep main main.rs` still runs.
- **Drift guard so the allowlist cannot rot silently again** (`8sync doctor`): an allowlist fails in two directions, and both have now happened — a name omp *drops* bricks every launch, a name omp *adds* disappears from the agent with no error at all. `models::step0_tool_drift` asks omp itself (`omp --tools __8sync_probe__ -p ""` — the validator runs before any provider call, so the probe is free and offline) and diffs the answer against `STEP0_TOOLS`, reporting `REJECTED by omp: …` or `missing omp tool(s): …`. Proven in both directions: injecting `bogus_tool` produced the REJECTED warning, reverting restored `✓ STEP-0 allowlist matches omp's tool list`.
- **`codegraph callers` demoted in the STEP-0 routing** (`assets/configs/omp/APPEND_SYSTEM.md`): on a clean, freshly rebuilt full index it reported `No callers found` for a function with two real call sites, and the misses cluster by *caller* (nothing inside `global_pass` resolves) rather than by callee — `let _ =` discards are not the cause. codegraph is a prebuilt external binary with no local source, so "who calls X" now routes to `mcp__serena_find_referencing_symbols`, with `codegraph callers` allowed only as a second opinion, never as proof of absence. The same note warns against `rm -rf .codegraph`, which deletes the exclusion config and makes the next index walk ~16k files instead of ~6k.
- **Toggle (never a trap):** default ON; `8sync ai --no-step0` for one run, or `step0 = false` in `~/.config/8sync/models.toml`.
- `APPEND_SYSTEM.md` RULE #0 rewritten to match reality: states that `grep`/`glob` are gone, gives a cheapest-first routing decision tree (cbm → serena → codegraph), and **drops the stale omp-16 `mcp.discoveryDefaultServers` claim** (omp ≥17 mounts MCP as `xd://` devices — that key no longer exists).

### Fixed — STEP-0 review pass: interceptor over-block + config-migration data loss
An independent reviewer (12 min) caught defects the happy-path tests missed; all verified live.
- **grep rule blocked single-file/log grep on hyphenated names** (`grep x-ray my-report.txt`, `grep bug build-Release.log`). The `.*(-[rR])` shape matched `-r`/`-R` *inside* words. The first repair (`\s-`) then over-corrected — `grep\s+` already consumed the space, so a first-token `grep -r` stopped matching and recursive grep was *allowed through*. Final pattern uses a negative lookbehind `(?<![A-Za-z0-9-])` so the dash must be a real token boundary, and excludes double-dash long flags from the short-flag matcher (`--color`/`--directories` contain an `r` but are not recursive). Verified 19/19 cases in Python before editing source, then live both directions: `grep -r` blocked, hyphenated-name grep + `--color=auto` allowed. Same lookbehind applied to the `find`/`fd` `-name`/`-type` rule.
- **config migration silently deleted user keys** — block-end detection used `is_ascii_alphabetic()`, so a following `# comment`, `_private:`, or `'quoted':` key was swallowed into the block and overwritten on the next `8sync harness`. Now ends at any column-0 line that is not an indented continuation, and the scan is no longer single-occurrence: every `bashInterceptor:` block is enumerated and only those carrying the `STEP-0` signature are removed (any ordering; duplicates collapse), so a user-authored block is never touched. Proven by replicating the exact Rust logic in Python against a config with comment + `_key` + quoted key + user block + ours.
- **doctor surfaced only one drift direction** — an omp upgrade that renames *and* adds reports both now (`rejected` and `silently_disabled` are no longer mutually exclusive arms).
- Trims the blank line that accumulated per `8sync harness` run.
- **Second review round — the `^` anchor made the guard mostly decorative.** `^\s*grep` only fires when the tool starts the command string, so `cd src && grep -r foo .`, `cd crates/cli && rg TODO`, `LC_ALL=C grep -r`, `sudo grep -r`, `time rg`, `cat x | grep -r y` and `; do grep -r …` all escaped. Rules now match at a **command position** — `(?:^|[;&|])` plus optional `\` escape, env assignments and wrapper words. `(` is deliberately not a separator and `do`/`then` are wrappers only, so quoted prose (`git commit -m '(rg removal)'`, `echo "do rg later"`) no longer trips the rule.
- **Substitutes closed:** blocking `rg` alone just moved the habit. `git grep` (recursive by default — the obvious fallback), `egrep`/`fgrep`, bare `fd '\.rs$'` and `fd -t f`, and `find -path`/`-regex` were all open. Tools with no single-file mode worth preserving (`rg`, `fd`, `git grep`) are now blocked outright; only `grep` gets flag analysis.
- **The grep rule is quote-aware.** It walks the option cluster (a run of shell words that are neither quoted nor containing `;&|`) instead of `.*`, so a flag-looking string inside the *search pattern* no longer counts: `grep " -r " f.txt`, `grep 'make -r' build.log`, `grep -F -- -r file.txt` and `grep pat /var/log/-r-rotated.log` are allowed again, and the scan can no longer cross into the next command (`grep foo a.txt; ls -r`). 48/48 cases verified against the patterns as actually written to disk, in omp's own JS engine.
- **P1 — a user-authored `bashInterceptor:` block was being silently voided.** The code appended its own block beside the user's, assuming a duplicate top-level key would make omp fail loudly. It does not: omp parses config.yml with `Bun.YAML.parse`, which keeps the **last** key, and 8sync always appends last — so every rule the user wrote disappeared on each `8sync harness`, with no error anywhere. The function now detects a surviving user block, leaves the file untouched, and warns instead of installing.
- Fresh-machine formatting: no stray leading blank line when `config.yml` did not exist.

### Fixed — omp 17 "Failed to load extension: mutable default value must be specified as a factory"
- omp 17.2.9 added a schema validator that rejects any zod `.default(<mutable>)` where the value is an array or object literal — it must be a **factory**: `.default(() => [])`. Primitives (`false`/`0`/`""`/`3`) are unaffected. Every `omp` session printed `Warning: Failed to load extension …/8sync-engine.ts: ParseError: A mutable default value must be specified as a factory`, so none of the `engine_*` tools registered.
- One site: `assets/extensions/8sync-engine.ts:146`, `verify: z.array(z.string()).default([])` → `.default(() => [])`. `8sync-workflow.ts` had no defaults. Verified: `omp -p` in the affected project loads the extension with zero warnings. The asset is rust-embedded, so this needs `cargo build` + `8sync harness` to redeploy; live project copies were refreshed directly for immediate relief.
- Note: the separate "`omp --continue` loses chat history" report is **not** caused by this — omp continues past extension-load failures. It is a distinct omp-17 symptom; retest `--continue` after this fix and diagnose separately if it persists.

### Changed — CI: `aarch64` builds without Docker, and the size budget is now enforced
- **`cross` → `cargo-zigbuild`** for `aarch64-unknown-linux-musl`. This fixes a correctness bug, not just speed: `cross` ran inside a Docker image with no JS toolchain, so `build.rs` could not build the Vite dashboard and **silently embedded the stub page** into that asset. zigbuild runs on the runner, where `npm` exists. Verified locally (zig 0.16.0 + cargo-zigbuild 0.23.0): 31.9 s → statically linked aarch64 ELF, **4 151 328 B — already under the 4 MiB goal**.
- **New `scripts/size-gate.sh`**, run on every release asset: hard-fails above a **5 MiB ceiling**, warns above the **4 MiB goal**. `AGENTS.md` §8 carried a budget nothing enforced, which is how the binary drifted 52 % over unnoticed. The ceiling sits above today's size on purpose — a gate that is already red gets ignored — and ratchets down as `size-report.sh` shows headroom. Both directions tested.
- **`universal2` rejected** (reversing the earlier proposal): a fat macOS binary makes every Mac user download both slices — the opposite of the goal — and would rename assets `install.sh` resolves by `${os}-${arch}`.

### Fixed — a directory merely *named* `su-code` made its parent look like a project
- `discover::detect_current_project_root` and `harness global`'s project test accepted any folder called `su-code` as proof of an omp project. Since this repo's own checkout is `~/Projects/tools/su-code`, an auto-stamp run from `~/Projects/tools` wrote a blank memory tree (`STATE.md`, `KNOWLEDGE.md`, `PLAYBOOKS.md`, …) **plus a 74-entry `skills/` tree into the repo root**.
- Both paths now share `discover::is_omp_project`, and the `su-code` marker requires the directory to actually contain memory (`skills/` or one of `STATE.md`/`KNOWLEDGE.md`/`PROJECT.md`/`PLAYBOOKS.md`/`skills.toml`). Verified three ways: a bare `su-code/` dir is left alone, an `AGENTS.md` repo is still stamped, and a memory tree without `AGENTS.md` is still detected.

### Changed — **binary is 24 % smaller**: 6 407 848 → 4 859 696 B, no feature removed (`lean-binary` M2)
- **Dropped `rusqlite` (−1 035 384 B).** `harness toolstats` never needed a database: its ingest opened with `DELETE FROM calls` and re-parsed every session JSONL on each run, so nothing ever persisted — 1 MB of embedded SQLite C answered `COUNT`/`GROUP BY` over rows the same process had just built. Now a single in-memory pass. Output is **byte-identical**, proven by running the old and new binaries against a frozen copy of the session tree; only the provenance line changed (`→ …/toolstats.db` became `← …/sessions/<slug>`). SQLite left `ORDER BY` ties in table-scan order, so ranking tie-breaks on first appearance to preserve it.
- **Replaced `elkjs` with `@dagrejs/dagre` (−512 768 B).** `elk.bundled.js` was 1 606 238 B of the 1 891 858 B dashboard chunk — 85 % of the frontend was a GWT-compiled Java layout engine serving two `layered` calls. New `web/src/layout.ts`; bundle down to 478 704 B (−75 %). A lazy `import()` was measured first and rejected: `rust-embed` embeds the whole `web/dist` tree, so chunk-splitting saves zero binary bytes. Verified headless — codegraph lays out in four clean LR ranks, workflow auto-layout chains top-down, zero page errors.
- **`toolstats` feature flag removed** — it guarded only `rusqlite`. `features` is now just `web`; a `--no-default-features` build *gains* the tracker and sits at 3 109 496 B, **25.86 % under the 4 MiB budget**.
- `AGENTS.md` / `README.md` size and tracker claims replaced with measured numbers.

### Added — `lean-binary` feature scope (GSD planning tree): M0 + M1 landed
- `su-code/planning/lean-binary/` — 4-phase roadmap to bring the binary back under the `AGENTS.md` §8 "< 4 MB" budget **without dropping a user-visible feature**: M0 land pending WIP · M1 feature gating + per-gate byte attribution · M2 eliminate rather than gate · M3 CI (`cargo-zigbuild` `aarch64-musl`, macOS `universal2`) + budget truth.
- **M0 PASS.** Baseline **6 407 848 B** vs the 4 194 304 B budget. Every commit in the range was replayed in a throwaway `git worktree` and built from scratch — 4/4 green — because `engine_verify` only ever sees the working tree.
- **M1 PASS (8/8 AC).** `crates/cli/Cargo.toml` gets its first `[features]` table: `default = ["web","toolstats"]`, `web` = axum + tokio + tower-http + scraper, `toolstats` = rusqlite. `marketplace` folds into `web` (single caller: `/api/marketplace`). A `--no-default-features` build now compiles **and runs**, warning-clean, with no JS toolchain — `build.rs` skips the Vite bundle when `CARGO_FEATURE_WEB` is unset. Gated subcommands say `rebuild with --features web` instead of failing as unknown.
- **New `scripts/size-report.sh`** — A/Bs four feature combinations into separate `--target-dir`s. Measured: full **6 407 144** · web-only 5 346 304 · toolstats-only **4 144 576** · minimal **3 081 416**. Per-gate cost: `web` **2 262 568 B**, `toolstats` **1 060 840 B**.
- **`cargo bloat` was wrong by ~26×** on SQLite (40 KiB claimed vs 1 060 840 B measured) — it attributes `.text` by symbol and is blind to `.rodata` and C blobs. Ranking tool only; every load-bearing number now comes from an A/B build.

### Added — `deep-research` §5 "Native & Binary-Weight Audits" + a measured audit of `8sync` itself
- `assets/skills/deep-research/SKILL.md` gains a 7-step protocol for native/binary-weight research: ground with `size -A`, attribute with `cargo bloat --crates` (and chase its `[Unknown]` C row through `build/*/out/*.a`), A/B every proposed flag into a scratch `--target-dir` with an explicit `--target`, record falsified knobs as `failure:` entries, trace surprise deps with `cargo tree -i`, prefer `[features]` gating over rewrites, and reach for Zig only as build tooling.
- Applied it to this repo — brief at `outputs/native-tooling-zig-rust.md` (+ plan/drafts/provenance). Headline: the binary is **6 406 696 B (6.11 MiB)** against the `AGENTS.md` §8 "< 4 MB" budget, and the cause is that `crates/cli/Cargo.toml` has **no `[features]` section** — `harness web` (axum/tokio/hyper), marketplace scraping (scraper/html5ever) and `harness toolstats` (bundled SQLite, 2.1 MB `.a`) link into every build, alongside 4.9 MB of embedded assets (`web/dist` 1.9 MB, `impeccable/scripts` 1.6 MB).
- Release-profile knobs proven exhausted by A/B: `opt-level="s"` is **+307 392 B** vs `"z"`; `-C force-unwind-tables=no` saves **704 B**; `-C relocation-model=static` breaks proc-macro builds. No profile change made.

### Added — `branch-sync` skill & automated script for zero-conflict multi-branch sync
- **`/sync-pr` slash command**: Deployed globally (`~/.omp/agent/commands/sync-pr.md`) and per-project (`.omp/commands/sync-pr.md`). Invoking `/sync-pr [<branch>]` in any omp session automatically loads the `branch-sync` skill, audits all local/remote branches, deep-previews and safely merges specified feature branches to `main`, and synchronizes all active branches to match latest `main` with zero conflicts.
- New skill `assets/skills/branch-sync/SKILL.md` + helper script `assets/skills/branch-sync/scripts/branch_sync.py`: provides complete audit, deep-preview (`git diff main...<branch>`, commit breakdown, conflict dry-run), safe merge to `main`, and zero-conflict multi-branch synchronization across all active local/remote branches without risk of merge conflict leaks or data loss.

### Enhanced — `8sync harness global` auto-detection for `su-code/` projects
- `8sync harness global` now automatically detects if the current working directory is an `omp` project (containing `su-code/` or `AGENTS.md`) and stamps its per-project harness layer (vendors global skills into `su-code/skills/`, injects `AGENTS.md`/`CLAUDE.md`, seeds memory, installs pre-commit hook, and initializes `codegraph`) without requiring manual `--sweep`.

### Enhanced — `deep-research` skill with AI Agent loop engineering & design patterns
- Deepened `assets/skills/deep-research/SKILL.md`: incorporates state-machine loop engineering (Plan → Execute → Verify → Advance), STEP-0 code intelligence (`codegraph`, `codebase-memory-mcp`, `serena`), multi-agent wave execution (`tasks[]`), headroom output compression, modality-fit vision routing, and ponytail YAGNI discipline for large real-world codebases.

### Added — `8sync omp update` verb (update omp + auto-repair a blocked install)
- New verb `crates/cli/src/verbs/omp.rs` (`8sync omp update`, `--force`): runs `omp update`
  and, when it fails with `npm error EEXIST … ~/.local/bin/omp` or bun `Fail extracting
  tarball`, auto-repairs — backs up the current binary, clears the standalone file squatting
  the symlink path, `npm install -g @oh-my-pi/pi-coding-agent@latest`, then re-resolves and
  reports `CURRENT → NEW`. Runs from the SHELL (not an omp `/command`) so it works even when
  omp is broken; native Rust, no `sudo`/system-pkg/git. `8sync up` note now points here.
- Verified live both paths: normal ("Already up to date" @ 17.0.7) and `--force` (backup → rm
  → npm reinstall → `~/.local/bin/omp` healthy `node_modules` symlink). Root cause: omp ships
  as a standalone binary that squats the bin path where the package manager wants a symlink.

### Added — Lark (larksuite) to the `apps-personal` profile
- `assets/profiles/apps-personal.toml` now installs Lark via AUR `larksuite-bin`
  (v7.66.11, URL larksuite.com) alongside Bitwarden. AUR bin package auto-fetches the
  official `.deb` at build time and is pacman-tracked — the 437 MB binary is NEVER
  committed to the repo/GitHub, only the download reference. Sets `requires.aur_helper`.
  China build (Feishu) is a separate package, `feishu-bin`. Opt-in; the `alexdev`
  bundle intentionally excludes `apps-personal`.

### Fixed — STEP-0 MCP tools were connected but NEVER called (0.09% usage) → always visible
- Root cause (measured over 29 omp sessions / 13,854 tool calls: serena 0 · headroom 0 ·
  cbm 10 · zai 3 calls; `search_tool_bm25` taken 2×): omp's default
  `tools.discoveryMode: auto` hides ALL MCP tools behind a `search_tool_bm25` discovery
  hop once the registry exceeds 40 tools (this stack registers 48), and every instruction
  surface taught BASE tool names (`search_graph`, `find_symbol`) that are not callable —
  the registered forms are `mcp__codebase_memory_mcp_search_graph`, `mcp__serena_find_symbol`, ….
- Fix: `8sync harness`/`harness global` now writes `mcp.discoveryDefaultServers:
  [codebase-memory-mcp, headroom, serena, zai-vision]` into `~/.omp/agent/config.yml`
  (`ensure_mcp_tools_visible` in `crates/cli/src/verbs/skill/deploy.rs`) — the four
  harness servers' full catalogs stay in the active tool set, zero discovery hops.
  Key-presence idempotent; never overrides a user-set value. NOTE:
  `tools.essentialOverride` does NOT work for MCP (omp filters entries to built-in
  tool names only — verified in omp 16.4.8 bundle); an inert pin block from that
  approach is auto-migrated away (byte-exact match only).
- Instruction surfaces now teach the REGISTERED `mcp__…` names + the
  `search_tool_bm25` escape hatch for other/new servers: `APPEND_SYSTEM.md` RULE #0,
  `00-force-load.md`, the AGENTS.md STEP-0 sentinel template (`inject.rs`), the
  capabilities catalog header, and the feature-skill R10 literals (assets + su-code
  mirror). Stale names dropped everywhere: `semantic_query` (never existed on cbm),
  `codegraph search/deps/defs` (real 1.1.2 verbs: `query/explore/node/callers/callees/impact`).
  Unfollowable headroom mandate ("compress before it enters context") rewritten to the
  followable form: compress what YOU re-emit (`mcp__headroom_compress`).
- `8sync doctor` now flags hidden MCP tools (`discoveryDefaultServers` missing) and a
  dead serena (mcp.json + uvx check). Live probe verified: `omp -p` calls
  `mcp__codebase_memory_mcp_search_graph` and `mcp__serena_find_symbol` directly — both OK,
  no discovery hop; toolstats records serena/cbm optimizer calls for the first time.

### Fixed — omp ≥17 dropped bm25 discovery; the recurring "MCP HIDDEN" was a phantom
- omp 17.x replaced the pre-17 tool-discovery model (the `search_tool_bm25` hop +
  `mcp.discoveryDefaultServers`) with `tools.xdev` (default on): MCP tools mount as
  `xd://mcp__…` device URLs, callable via read/write without shipping schemas every
  request. `discoveryDefaultServers` is gone from omp's settings schema — writing it is
  a no-op that omp strips on the next config rewrite. That churn is exactly why STEP-0
  looked like it "regressed" after every omp self-upgrade (upgrade resets `config.yml`
  → doctor's string-check screamed HIDDEN → re-harness → repeat), while the tools were
  callable all along (verified live via `xd://mcp__codebase_memory_mcp_*` this session).
- `ensure_mcp_tools_visible` (`deploy.rs`) now detects omp ≥17 and skips the dead key
  (nothing to configure — `tools.xdev` mounts them); pre-17 keeps the discoveryDefaultServers write.
- `8sync doctor` MCP check is omp-version-aware: omp ≥17 reports the xd:// mount (OK)
  instead of the false "HIDDEN behind search_tool_bm25" warning; the `harness global`
  summary bullet updated to match. New `env_detect::omp_major()` parses omp's major version.

### Added — omp `/push-now` command (cross-machine handoff + commit + push)
- New embedded command `assets/commands/push-now.md`, deployed by `8sync harness`
  (`ensure_engine` in `crates/cli/src/verbs/skill/deploy.rs`) to
  `~/.omp/agent/commands/push-now.md` (global) + `<repo>/.omp/commands/push-now.md`
  (project), alongside `/auto` and `/feature`. `/push-now [msg]` is the
  "I'm switching machines right now" verb: it rewrites `su-code/STATE.md` with a
  cold-resume handoff (branch/HEAD, what changed this session, done/next/blockers,
  new-machine runbook), updates `CHANGELOG.md`/`KNOWLEDGE.md` if code changed, then
  `git add -A` + commit (gitleaks-gated, no `--no-verify` past a real secret) +
  `git push` origin current branch. No PR, no branch switch, no tag bump, no
  force-push (that's `8sync ship` / a release). Since it's in `assets/`, a fresh
  machine gets it automatically after `git pull && bash scripts/bootstrap.sh && 8sync harness`.

### Added — omp `/pull-now` command (cold-resume: pull + orient + prepare)
- New embedded command `assets/commands/pull-now.md`, deployed by `8sync harness`
  the same way (`ensure_engine`) to `~/.omp/agent/commands/pull-now.md` +
  `<repo>/.omp/commands/pull-now.md`. `/pull-now [go]` is the **receiving end of
  `/push-now`**: safe `git pull` (ff-only → rebase on divergence; stop on conflict
  or dirty tree), then read `su-code/STATE.md` HANDOFF + recent `KNOWLEDGE.md`
  learnings + `CHANGELOG.md`/`git log` to understand exactly where the project is,
  prepare the workspace (rebuild + `8sync harness` if `crates/`/`assets/` changed,
  verify the per-machine gotchas the handoff listed, `8sync doctor`), and report
  current state + the single next concrete action. `go` = start that action;
  empty = orient + prepare, then STOP for the human. No push, no clobber.

Older releases (0.52.0 and down) live in [CHANGELOG-ARCHIVE.md](CHANGELOG-ARCHIVE.md).
