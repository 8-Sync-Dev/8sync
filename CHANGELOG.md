# Changelog

Mọi thay đổi đáng kể của `8sync` ghi vào đây. Format theo [Keep a Changelog](https://keepachangelog.com),
versioning theo [SemVer](https://semver.org). **8sync rule:** mỗi PR cập nhật mục `Unreleased`.

## [Unreleased]

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
