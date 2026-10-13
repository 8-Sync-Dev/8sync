<!-- 8sync:harness:begin -->
## 🧠 8sync harness

- **Always-on (đọc theo thứ tự; CORE đọc body ngay, SPECIALIST đọc khi task khớp):** codegraph → karpathy-guidelines → ponytail → assp-skill → impeccable → taste-skill → 8sync-cli → image-routing → locate-anything.
- **Cách tận dụng:** codegraph = explore code (query/callers/callees, không grep) · karpathy + ponytail = YAGNI, làm ít nhất, xoá > thêm · impeccable = design CHUẨN, BẮT BUỘC khi UI/design (đọc body lúc đó) + taste chống slop.
- **Output lớn (>~50 dòng) → BẮT BUỘC `headroom_compress`** trước khi vào context.
- **Sau mỗi thay đổi:** cập nhật `CHANGELOG.md` (Unreleased) + ghi học được vào file này (prefix `validated:` nếu test/build xác nhận, `hypothesis:` nếu chưa).
<!-- 8sync:harness:end -->

# KNOWLEDGE (8sync managed — append-only)

## Learnings (append-only — ghi DƯỚI đây; KHÔNG sửa block `8sync:harness` ở trên)
_(consolidated 72 dòng cũ → su-code/archive/KNOWLEDGE-1790603711.md)_
- **validated: a "content-gated" migration must compare against every version it ever shipped, not
  the current one.** v0.55.0's un-prefixed-command cleanup only deleted a file byte-identical to
  today's asset — but the same release rewrote every command body, so the compare could never match
  and all 8 `/auto` + `/sx-auto` pairs survived on every upgraded machine. Observed here: each stale
  file hashed exactly to the **v0.54.1** blob. Lesson: when the migrating release also changes the
  content, "is this ours?" needs a frozen digest set, not an equality check against HEAD.
- **validated: 3440x1440@180 was never a GNOME setting.** DRM filters modes by negotiated link
  bandwidth *before* userspace sees them, so a 180 Hz panel on `nouveau` (RTX 5080/Blackwell — no
  DSC, no UHBR) reads as "max 100 Hz" everywhere: `/sys/class/drm/*/modes`, Mutter's
  `GetCurrentState`, GNOME Settings. Ground truth is the panel's EDID range-limits descriptor
  (`0xFD`: vmin 48, **vmax 180**, max pixclk **970 MHz**), which is driver-independent. Comparing
  EDID against the compositor's mode list turns "your max is 100" into a named bottleneck.
  100 Hz at 3440x1440 8bpc ≈ 543 MHz pixclk — exactly the DP HBR2 ceiling, which corroborates it.
- **validated: Mutter mode-setting goes through `busctl`, not `gdbus`.** `busctl --user
  --json=short call … GetCurrentState` returns parseable JSON (gdbus returns GVariant prose), and
  `ApplyMonitorsConfig` takes the explicit signature `uua(iiduba(ssa{sv}))a{sv}` with every array
  count-prefixed — no introspection round-trip. Method `0` = VERIFY (validates, touches nothing),
  `2` = PERSISTENT. It replaces the **entire** layout, so position/scale/transform/primary must be
  echoed back or they reset. Proven live: 100 → 60 → 100 Hz with the layout intact.
- **validated: the fastest mode is often the smallest.** This panel offers 2560x1440@144 while
  running 3440x1440@100. Any "set max refresh" that sorts on Hz alone silently shrinks the desktop —
  filter to the current resolution first.
- **failure: `/sys/class/drm/<card>-<conn>/device` is the DRM card, not the PCI function.** The
  `driver` symlink lives one hop further up, so the first cut of the driver diagnosis printed
  nothing at all. Walk ancestors until one has `driver`; never hardcode the hop count.
- **validated: a broken GUI does not mean broken hardware support.** `lianli-gui` died instantly
  with `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display` while
  `lianli-daemon` had been up for three hours with all 13 devices enumerated. The whole feature was
  reachable over its IPC socket; the fix for the GUI itself is one env var,
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` (survived 12 s vs 2.7 s to crash). Check the daemon before
  believing the app.
- **validated: `lian-li-linux` IPC.** Newline-delimited JSON on
  `$XDG_RUNTIME_DIR/lianli-daemon.sock`; requests are `{"method":"X","params":{…}}`
  (`#[serde(tag="method", content="params")]`), replies `{"status":"ok","data":…}`. LCD media is
  `SetLcdMedia{device_id, config}` where `config.serial` must equal the device's `device_id`
  (`hid:…`) **and** `device_id` must be `serial:<that id>` — upstream matches on
  `LcdConfig::device_id()`, so any other spelling appends a duplicate instead of replacing.
  `type` is one of `image|gif|video|color|sensor|doublegauge|cooler|custom`; paths must be
- validated: (Kernel default boot mismatch root-causes system driver losses): On Fedora 44 with dual kernels (e.g. 7.1.7 testing vs 6.19.10 official), GRUB defaults to the higher lexical version (7.1.7). If 7.1.7 lacks specific modules like `btusb.ko.xz`, Bluetooth service fails completely (`bluetooth.service` inactive). Fix: `grubby --set-default=/boot/vmlinuz-6.19.10-300.fc44.x86_64` permanently forces the official kernel with full driver stack (`btusb`, `nvidia`, 180Hz) on all reboots.
- validated: (Lian Li TLV2 Wireless LCD config lock vs image pipeline): In Lian Li daemon `config.json`, setting a fan entry to `"type": "color"` with `"rgb": [255, 0, 0]` locks the fan to red and rejects IPC image frames. Updating `config.json` to `"type": "image"` unlocks the fan for realtime LCD sensor dashboard streaming (`/tmp/lcd_m_*.png`).
  absolute (the daemon has its own cwd).
## STEP-0 must be a deny-list, not an allowlist (2026-08-14)

- **failure: mirroring another program's tool list bricks the launcher.** STEP-0 shipped omp a
  `--tools` ALLOWLIST, so 8sync had to name all ~29 built-ins to drop 2. omp 17.3 renamed
  `ast_grep` → `ast_edit` and dropped `github`/`checkpoint`/`rewind`/`security_scan`, and every
  `8sync .` / `8sync ai` died at argv-parse time with `CliUsageError: Unknown tools in --tools`.
  Rule: when you only want N things GONE, use the API that names those N. `omp` has one —
  `grep.enabled`/`glob.enabled` (settings.md §"Individual built-in tools are toggled by their own
  keys") — passed per-launch as a `--config` overlay so `--no-step0` and bare `omp` stay clean.
- **failure: omp's "Valid tools:" error list is NOT a stable inventory.** It is a snapshot of
  whatever is registered at validation time, and MCP/xdev registration is async: two runs of the
  same binary in the same cwd returned 64 vs 65 names, and a real project returned 35 built-ins
  with zero `mcp__*` while `/tmp` returned 17 built-ins plus 47 `mcp__*`. Any allowlist derived
  from that probe — and the old `step0_tool_drift()` doctor check built on it — is unsound.
  Verify enforcement instead: with the overlay, `omp --tools grep,glob -p ""` must be REJECTED.
  `--tools` is validated before any provider call, so the check is offline and free.
- **validated: a crashing launcher reads as a data-loss bug.** `8sync . core` printed
  `→ resume session 'core'`, omp exited before drawing a frame, and the user typed
  `omp --continue` — which reads omp's DEFAULT per-cwd store (`~/.omp/agent/sessions/<key>/`),
  not the named store (`~/.config/8sync/sessions/<key>/<name>/`). The named session looked lost.
  The two stores are correctly isolated (proven: `--session-dir` on an empty dir starts fresh and
  does not leak into the default store), so the cure was fixing the launch, plus printing the
  `omp --session-dir … --continue` line that reopens a named session without 8sync.
- **validated: the both-directions registry test earns its keep again.** `every_asset_skill_is_
  registered_or_explicitly_opt_in` caught 4 foundation skills (tauri-v2, nextjs-app,
  encore-eino-go, ai-microservice-design) embedded in the binary and advertised in AGENTS.md but
  absent from `BUNDLED_SKILLS`, so `8sync harness` never deployed them to `~/.omp/skills/`.
- **failure: `fs::write` is not an atomic config update, and the Windows runner proves it.**
  Three tests shared the one real `~/.config/8sync/omp-step0.yml`; cargo runs them in parallel,
  one caught the truncate window and read `""`, and the release CI's windows-x86_64 leg failed
  while all four unix legs passed. Two fixes, both needed: write via pid-unique sibling +
  `fs::rename` (atomic, and `rename` replaces on Windows too) so no reader — including the omp
  process being handed the `--config` — can see a half-written file; and give writing tests their
  own path under `env::temp_dir()`. A test that writes a real user-scoped path is not isolated.
- **validated: watch the release run, do not assume the tag published.** `v0.57.0`'s tag push
  built 4/5 platforms and SKIPPED `publish release`, so no assets and no GitHub release existed —
  the tag could be deleted and re-cut with no consumer impact. Check
  `gh run view <id> --json jobs` per leg, not just the run conclusion.
- **failure: a pid is not a unique temp name — threads share it.** The atomic-write fix staged
  `.omp-step0.<pid>.tmp`; two test threads in ONE process picked the same sibling and the loser's
  `rename` hit an already-moved file, returned `None`, and silently dropped STEP-0 for that call.
  Windows went green and linux-x86_64 went red on the very next run. A stage filename needs
  pid **plus** a per-call atomic counter. Covered now by `step0_overlay_survives_concurrent_
  writers` (8 writers × 25 + 4 readers asserting no torn read, no leaked stage file).
- **validated: omp 17.3.x self-update is a ~185 MB standalone download with zero progress
  output and no internal timeout.** On a ~640 KB/s link that is 5+ minutes of silence that
  users read as a hang; Ctrl-C leaves `~/.local/bin/omp.<ts>.<pid>.0.new` partials (up to
  185 MB each). Canonical repair is `curl -fsSL https://omp.sh/install | sh -s -- --binary`
  (GitHub releases → `~/.local/bin/omp`), NOT `npm install -g @oh-my-pi/pi-coding-agent` —
  the npm channel diverges from the omp.sh layout `8sync setup` installs. Verified live:
  `8sync omp update --force` reinstalled 17.3.3 in 373 s with heartbeat + partial sweep.

## omp 17.4 bundles zod v4 — mutable array defaults kill extension loading (2026-08-21)

- **validated: `.default([])` array-literal defaults now throw "ParseError: A mutable
  default value must be specified as a factory" at extension load.** omp 17.4's bundled
  zod v4 rejects object/array defaults that are not factories; the failing extension is
  skipped (warning banner) while every other extension keeps loading, so the damage is
  silent tool loss, not a crash. Trigger sites were `ckit-engine.ts:146`
  (`verify: z.array(z.string()).default([])`) and `8sync-gs/index.ts:257`. Primitive
  defaults (`.default(false)`, `.default("")`) are unaffected; write
  `.default(() => [])` in new extensions. Stale copies are swept by
  `remove_retired_extensions` (crates/cli/src/verbs/skill/deploy.rs) on every
  `8sync harness` / `harness up`.
- **failure: gate a name-based sweep on the full lineage marker, not a bare mention.**
  The first `ckit-*` content gate used `contains("8sync")` and the sandbox's own control
  file ("not 8sync") matched it — a user file that merely mentions 8sync would have been
  deleted. Gate: `contains("8sync-engine") || contains("8sync-workflow")`. Proof pattern:
  plant a mention-only control file in the sandbox and assert it SURVIVES the sweep, not
  just that stale files die.

## report-pdf engine port — self-contained PDF skill (2026-08-21)

- **validated: port the design system, not the tool.** The admired CloudGO PDFs came from
  an HTML design system (review-mr / business-brief templates). Porting the TEMPLATE + a
  12-line build.sh into a bundled skill made the capability machine-portable with zero
  Rust deps, while the old ReportLab tool path had already rotted away
  (`tools/report-github-md2pf` deleted from the repo). The guard pair
  (`every_asset_skill_is_registered_or_explicitly_opt_in`, both directions) makes
  registration self-enforcing. E2E proof pattern that generalises: render from the
  DEPLOYED copy (`~/.omp/skills/report-pdf/`), not the repo tree, then zai-vision a
  token checklist (kicker, §N spine, navy table, pills, footer page numbers) — 3 pages,
  all YES.
- **failure: `engine_advance {commit:true}` stages the WHOLE worktree, not the task's
  files.** It swept a pre-existing 224-line `omp.rs` fix into a commit titled after an
  unrelated skill task. Recovery: `git reset --soft HEAD~1` + per-group commits before
  continuing the engine run. Prevention: land or stash pending work BEFORE starting an
  engine run with commit:true.
- **rename note (2026-08-21, same session):** the ported skill SHIPS as `super-pdf` (v0.58.0). Paths `~/.omp/skills/report-pdf/…` in the entries above are the pre-release draft name — post-release the deployed path is `~/.omp/skills/super-pdf/` and the mirror `su-code/skills/super-pdf/` (gitignored). Any `su-code/skills/report-pdf` dir found on disk is a mirror re-vendor leftover; safe to delete.

## Size ceiling recalibration (2026-08-21)

- **validated: the ratchet needs recalibration when FEATURE releases, not bloat, eat the headroom.** linux-x86_64 (musl, CI): v0.54.1 5,074,384 → v0.55.0 5,078,512 → v0.56.0 5,160,432 → v0.57.0 5,238,672 (4,208 B under the 5 MiB ceiling) → v0.58.0 5,259,280 (over by 16,400). Attribution: `web` feature gate = +1,732,232 B (the elephant); v0.58 delta +20,608 B = omp-update hardening + retired-extension sweep + super-pdf skill (compressed ~4 KB) — all wanted. Decision: ceiling 5,242,880 → 5,304,320 B (5,180 KiB), tight on purpose so the NEXT release trips it and must attribute. Local gnu builds run ~52 KB smaller than CI musl — gate the CI musl number, not the local one.

## RC — v0.58.0 post-release review found 3 escapes (2026-08-21)

- **failure: CHANGELOG skipped a release-blocking infra change.** The ceiling-raise commit `4527acf` (enforced gate `scripts/size-gate.sh`) shipped inside v0.58.0 with NO CHANGELOG entry because the repair ran in crisis mode (gate fail → fix → re-tag fast) and the “update CHANGELOG after every change” rule was dropped exactly when it mattered most (release-blocking changes). Fix rule: any commit that lands between first failed tag and re-cut MUST be audited against the changelog before the re-tag push.
- **failure: `.gitignore` contradicted itself** (line 12 kept `su-code/skills/` in KEEP-COMMITTED while line 36 ignored it; comment 33-35 was the truth). Latent since 0.46.0, surfaced only by review — no gate checks `KEEP COMMITTED` claims against the ignore entries. Fixed by deleting `su-code/skills/` from line 12 (mirrors are intentionally untracked, rebuilt by `8sync harness`).
- **design-accepted: tag ≠ HEAD.** Doc-only commits (`afe9801`, `3a9f9bd`) landed after the re-cut tag `4527acf` — `su-code-release-cut` skill step 9 EXPLICITLY prescribes a doc-only post-tag follow-up, so tag≠HEAD is the sanctioned pattern, not a defect. The only real rule: release-relevant content changes (CHANGELOG entries about what vN shipped) belong BEFORE the tag, docs *about the release act* (STATE tick, release notes tweaks) may follow.

## v0.59.0 — `8sync harness create` host adapters (2026-08-25)

- **validated: Cursor does not auto-load `su-code/skills/`.** Project skills must live at `.cursor/skills/<name>/SKILL.md` plus `.cursor/rules/*.mdc` (`alwaysApply`). Z.ai Code uses `.zcode/skills/`. Canonical tree stays `su-code/skills/`; hosts are a relative symlink / Windows junction (`../su-code/skills`). Never `remove_dir_all` a junction — on Windows junctions are reparse points, not always `is_symlink()`. Sweep default `~/Projects` misses `C:\Users\Admin` + sibling `C:\Users\Projects`; fall back to `<home-parent>/Projects`. Do **not** copy `~/.omp/agent/mcp.json` into `.cursor/mcp.json` (API keys). Gitignore host skill mirrors; **commit** `.cursor/rules/`. Do **not** put `su-code/skills/` back into the managed KEEP-COMMITTED comment (v0.58 RC).
- **failure (this session):** the working copy at `C:\Users\Projects\su-code` had **no `.git`** and was frozen at 0.56.0 while GitHub was v0.58.0. Shipping from that tree would have rewound sx-plan / super-pdf / omp-17.4 fixes. Always `git fetch` + compare `Cargo.toml` version to `gh release list` before tagging.

## GLM-5.3 native vision (2026-08-30)

- **validated: GLM-5.3 / GLM-5.3-Flash are native VLMs**, not text-only. Docs: https://docs.z.ai/guides/vlm/glm-5.3-flash — images go in `messages[].content[]` as `type: image_url` (URL or base64). The old always-on line “GLM-5.2 cannot. Route every real image through zai-vision MCP” made every Z.ai session bounce pixels to `@z_ai/mcp-server` / `glm-4.6v-flash`. Fix: APPEND_SYSTEM + image-routing look-first; zai-vision SKILL has a STOP gate for `glm-5.3*`; keep the MCP as GLM-5.2 fallback only. Alias `glm`/`zai` → `zai/glm-5.3-flash`. Combo vision role = cheap when cheap is a native VLM.
- **failure:** treating “Z.ai model” as “needs zai-vision MCP”. The MCP is a **sidecar for text-only GLM-5.2**, not the vision API for GLM-5.3. If the session model contains `glm-5.3`, calling `mcp__zai_vision_*` is a bug.

## Claude Code settings & Anthropic auto-setup (2026-09-04)

- **validated: one-command Claude Code settings & Anthropic models auto-setup (`8sync harness claude-code`).**
  Accepts the standard Claude Code settings JSON payload (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `CLAUDE_CODE_ATTRIBUTION_HEADER`). Automatically writes
  `~/.claude/settings.json`, configures Windows User environment variables, updates `~/.omp/agent/models.yml`
  with the 9 current Claude models under both `anthropic` and custom provider slug, configures
  `anthropic-budget-effort` thinking, sets `anthropic/claude-fable-5-1:high` as default role, and verifies
  connectivity with a live probe.
- **validated: Anthropic relay gateways (e.g. apikey.fun) require `/v1` in baseUrl for omp's `anthropic-messages` API.**
  When setting up custom providers in `models.yml`, `baseUrl` must be `https://api.apikey.fun/v1` so omp appends
  `/messages` to reach `/v1/messages`. Custom gateways that enforce Claude Code client access reject `/v1/chat/completions`
  with permission error but allow `/v1/messages`.

## AI Image Generation via gpt-image-2 & Codex endpoint (2026-09-04)

- **validated: `gpt-image-2` on `https://api.apikey.fun/v1/images/generations` returns high-res PNGs.**
  The endpoint accepts `model: "gpt-image-2"`, `prompt`, `size` (1024x1024, 1536x1024, etc.), `n: 1`.
  Response data returns either base64-encoded bytes in `data[0].b64_json` or a CDN URL in `data[0].url`.
  Request requires `Authorization: Bearer <key>` and optionally `x-openai-actor-authorization: apikey.fun`.
  Standard DALL-E model strings (e.g. `dall-e-3`) are rejected with "requires an image model".
- **validated: `openai-responses` wire API in omp works for Codex models.**
  Models registered in `~/.omp/agent/models.yml` under `api: openai-responses` (with `baseUrl: https://api.apikey.fun/v1`
  and custom header `x-openai-actor-authorization: apikey.fun`) support `gpt-5.6-sol`, `gpt-5.6-terra`,
  `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
- **validated: `8sync gen-img <prompt> -o <file.png>` CLI verb and `image-gen` skill deployed machine-wide.**
  Allows any project or agent to generate images without python/pip dependencies. VLM models (GLM-5.3-Flash,
  Opus) can immediately verify the result in-session with `read path: "<output.png>"`.

## codex-web bridge: DEV harness vs PRODUCTION launcher (2026-09-13)
- **failure: the source launcher (`bun run app`) builds a DEV harness that can NEVER serve omp.**
  Running codex-chatgpt-web from source creates an isolated dev profile at `~/.codex-chatgpt-web-dev/`
  with `config.json` `purpose: "dev-harness"`, connector name `Codex Native2 DEV`, and a "DEV" badge in
  the launcher UI. `src/server.ts:775` hard-blocks it: *"DEV harness configuration cannot start a
  Responses listener"* — so `:17841` never comes up and omp sees no `chatgpt-web` provider, no matter how
  fully you complete login + MCP tunnel + connector. `src/setup.ts:411` likewise refuses to install a DEV
  config into Codex. The dev flow uses the internal `dev-chat` transport, not real browser automation.
- **validated: real omp use requires the installed PRODUCTION app.**
  Install via `irm https://github.com/miuuyy/codex-chatgpt-web/releases/latest/download/install-launcher.ps1 | iex`
  (Windows) → runs as `%LOCALAPPDATA%\Programs\Codex Web GPT\Codex Web GPT.exe`, uses home
  `~/.codex-chatgpt-web/` (no `-dev`), `purpose` unset, connector `Codex Native2`. Its supervisor starts
  the daemon that serves the loopback Responses API on `:17841`. Only then does `8sync codex-web wire`
  detect `/v1/models` and register the isolated `chatgpt-web` provider into omp.
- **validated: `8sync codex-web up` must launch the prod app, not `bun run app`.**
  Fixed `codex_web.rs`: `up` now calls `resolve_prod_app()` (per-OS packaged app) and only uses the source
  `bun run app` launcher when `--dir`/`CODEX_WEB_DIR` is set explicitly (tool-dev). Distinguish the two
  launchers by process name (`Codex Web GPT.exe` = prod) vs command line (`codex-chatgpt-web` = dev source),
  and by the `.codex-chatgpt-web` vs `.codex-chatgpt-web-dev` home dir. `git-bash` mangles
  `taskkill //PID //T //F`; use PowerShell `Stop-Process -Id -Force` filtered on `Win32_Process.CommandLine`.

## feynman auth-omp on Windows: sqlite runner fallbacks (2026-10-07)
- **failure: `8sync feynman auth-omp` failed on Windows with "sqlite3 not found - install it (`pacman -S sqlite`)".**
  Windows machines running scoop/winget rarely have `sqlite3.exe` CLI installed, and the error advice
  (`pacman -S sqlite`) assumed Arch Linux/CachyOS. Since `rusqlite` was previously removed to reduce binary
  size by ~1MB, `feynman.rs` relied exclusively on `which("sqlite3")`.
- **validated: zero-dependency SQLite query fallbacks via Python, Bun, or Node.**
  Both `python` (stdlib `sqlite3`), `bun` (`bun:sqlite`), and `node` 22+ (`node:sqlite`) are present on typical
  dev workstations and can query SQLite database tables sub-second (0.13s) without external dependencies.
  Chaining: `sqlite3` CLI → `python3`/`python`/`py` → `bun` → `node`/`nodejs` guarantees seamless execution across
  Windows, macOS, and Linux.
- **validated: unwrap JSON token envelopes from `omp token <provider> --raw`.**
  Providers like `google-antigravity` return a JSON envelope (`{"token":"ya29...", ...}`) rather than a bare
  string. Unwrapping `"token"` ensures Feynman's `auth.json` receives the valid OAuth bearer token.

## feynman named sessions & Windows Node 24+ ESM loader (2026-10-07)
- **validated: `8sync feynman <name>` per-project research session management.**
  Brought parity with `8sync . <name>` for the Feynman research agent (`companion-inc/feynman`).
  Maps `<name>` to an isolated `--session-dir` at `~/.config/8sync/feynman-sessions/<project-key>/<name>`,
  tracks `last_used` and `last_active` in `index.json`, supports `ls` / `rm` / `new`, and auto-bridges omp
  credentials on first launch.
- **failure: Feynman's `launch.js` crashes on Windows Node 24+ with `ERR_UNSUPPORTED_ESM_URL_SCHEME`.**
  Feynman's `launchPiChat` spawned Node with `--import <promisePolyfillPath>`, passing raw Windows paths
  like `C:\Users\...`. Node's ESM loader on Windows strictly requires `file://` URLs for `--import`.
  Passing bare `C:\` throws `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'`.
- **validated: auto-patching `launch.js` with `pathToFileURL` in `8sync feynman`.**
  Converting import paths to `pathToFileURL(p).href` (`file:///C:/...`) fixes Node 24+ execution cleanly.
  `8sync feynman` detects and auto-heals `dist/pi/launch.js` before launching Feynman on Windows.
- **failure: `pi-tui` crashed on startup with "Rendered line exceeds terminal width (96 > 91)".**
  Feynman's banner or extension prompt list (`/gather-context-and-clarify`) exceeded narrow terminal windows.
  `@mariozechner/pi-tui/dist/tui.js` threw an unhandled exception when any line exceeded terminal width.
- **validated: auto-truncating lines in `pi-tui` instead of crashing.**
  Patched `tui.js` to call `truncateToWidth(line, width)` when `visibleWidth(line) > width`, preventing terminal crash.
- **validated: npm-global `@earendil-works/*` backward-compatibility aliases.**
  Upstream pi packages renamed from `@mariozechner/*` to `@earendil-works/*`. Linking `@mariozechner/*`
  to `~/.feynman/npm-global/node_modules/@earendil-works/*` resolved module resolution for `pi-subagents`,
  `pi-web-access`, and `@aliou/pi-processes`.

## session resume model persistence vs forced GLM default (2026-10-07)
- **failure: resuming an omp session (`8sync .`, `8sync . <name>`, `8sync ai continue`) switched model to GLM.**
  `resume_flags()` in `crates/cli/src/models.rs` emitted `--model <roles.default>`, which defaulted to `"glm"`
  in `assets/configs/models.toml`. Passing `--model glm` alongside `--continue` forced `omp` to override whatever
  model was saved in that session (e.g. Gemini 3.8 Flash, Claude Opus) to GLM on every resume.
- **validated: omit `--model` in `resume_flags()` to preserve active session model.**
  When continuing/resuming an existing session in `omp`, omitting `--model` allows `omp` to load and maintain the
  exact model saved in the session transcript. `--model` is now only passed when explicitly requested by the user
  (e.g. `8sync ai --model <m> continue`), and `[roles].default` in `models.toml` defaults to `""` (omp decides).

## feynman /model switching & Windows execution traps (2026-10-08)
- **failure: `/model` in Feynman failed with "No API key for ..." or crashed when selecting models.**
  Multiple compounding root causes:
  1. `google-antigravity` was mapped to `"google"`, but in `pi-ai` `"google"` is API-key only (no OAuth provider exists for `"google"`). This made all 24 Gemini models display `No API key for google/...`. Furthermore, none of the real Antigravity models (`claude-opus-4-6-thinking`, `claude-sonnet-4-6`, `gemini-3-flash`, `gemini-3.1-pro-high`) were recognized.
  2. API keys (`zai`, `nvidia`) were stored as `{"type": "api_key", "key": "!omp token <p> --raw"}`. On Windows, `pi-coding-agent` uses `C:\Windows\System32\bash.exe` (WSL bash), which cannot find Windows binaries, exits with status 127, and `resolveConfigValue` returns `undefined` for all 10 ZAI models and NVIDIA models.
  3. Anthropic OAuth token hit 429 rate limit, but `settings.json` defaulted to `anthropic/claude-opus-4-6`, causing Feynman to crash on startup or turn launch.
  4. `8sync feynman` intercepted subcommands like `model list` or `doctor` and treated them as session names to resume.
  5. `pi-subagents` extension threw `Cannot read properties of undefined (reading 'selectedTools')` on turn launch because `event.systemPromptOptions.selectedTools` was accessed without optional chaining.
- **validated: preserve `google-antigravity` with complete OAuth payload & pre-resolve API keys.**
  1. Keep `google-antigravity` as `google-antigravity` and parse the raw JSON from `omp token google-antigravity --raw` to store `token`, `projectId: "aicode-consumers"`, `refreshToken`, `expiresAt`, `email`.
  2. For API key providers (`zai`, `nvidia`), directly resolve the token in Rust and write literal `key: "<token>"`, avoiding any shell process spawn.
  3. In `settings.json`, automatically repair failing default models (`anthropic/claude-opus-4-6`) to verified available models (`google-antigravity/gemini-3-flash` or `zai/glm-5`).
  4. On Windows, launch Feynman via direct `node bin/feynman.js` instead of `cmd /C feynman.cmd` for clean stdio inheritance and signal handling.
  5. Pass through subcommands (`model`, `doctor`, `setup`, `chat`, etc.) and flags (`--model`, `--prompt`) with `allow_hyphen_values` in Clap.
  6. Auto-patch `pi-subagents` with optional chaining `event.systemPromptOptions?.selectedTools?.includes("subagent")`.

## omp win32-input-mode delayed framing (2026-10-08)
- failure: omp 18.8.3 `Win32PasteMarkerNormalizer` timed out after 75 ms and flushed an incomplete transport record. Reproduction: send `ESC[8;14;8;1;`, wait 180 ms, send `0;1_`; original emitted two chunks, letting the numeric suffix become editor text. This proves a leak mechanism, not the exact timing of the user's live session.
- validated: preserve pending raw ESC and bounded numeric CSI prefixes until the record terminator arrives. A user's Escape is a complete win32 key record and retains the existing 75 ms relayed-Escape behavior. 23 Windows input tests pass (111 assertions), including every Backspace split position delayed 500 ms; compiled and installed `omp.exe --smoke-test` passes.
- Runtime source/build: `C:\Users\Admin\tmp\omp-terminal-fix` (upstream 18.8.3). Durable source/test diff: `scripts/omp-win32-record-framing.patch`. Installed `C:\Users\Admin\AppData\Local\omp\omp.exe`; original backup `omp.exe.pre-win32-framing-20261008-094351.bak`. Running sessions must restart; automatic omp updates can overwrite this local hotfix. No auth/model/default settings changed.

## Feynman `/` swallowed by an extension shortcut (2026-10-08)
- failure: in Feynman 0.2.16 (Pi 0.62.0) typing `/` inserted nothing, even mid-line, so slash commands were unusable. Cause: `@mariozechner/pi-tui` `parseKeyId` keeps only ctrl/shift/alt, so `super+/` parses as bare `/`; pi-btw registers `Key.super("/")` as a default focus shortcut and the host consumed every `/`. Proof: `matchesKey("/", "super+/") === true`.
- validated: `ensure_feynman_windows_esm_patch` makes `parseKeyId` return `null` when any modifier is not ctrl/shift/alt (patches Feynman's `node_modules` and `.feynman/npm` pi-tui copies; idempotent). ConPTY drive via `uv run --with pywinpty --with pyte` (Git-bash PTY shows nothing for Node TUIs): `/` opens the command menu, `/mod` filters to `model`.
- Applied on each `8sync feynman` launch (Windows only); `feynman update` can restore the unpatched parser until the next 8sync launch. Running plain `feynman` after one 8sync launch stays fixed.

## Feynman `claude-opus-5-5` model registration (2026-10-08)
- failure: Feynman 0.2.16 (Pi 0.62.0) rejected `claude-opus-5-5` with `Model not available in Pi auth storage` because its bundled `models.generated.js` stopped at `claude-opus-4-6`.
- Historical registration proof only: injecting `claude-opus-5-5` into Pi's catalog made `model list`/`model set` accept the ID. It did not verify adaptive thinking or inference. Superseded by the native gateway bridge below.

## Feynman automatic omp catalog and native transport (2026-10-08)
- failure: Feynman's patched truncation branch omitted the existing `truncateToWidth` import and assigned to `const line`. Importing alone would expose the second error. Patch only the truncating variant; the older bundled renderer intentionally throws on overflow and must remain unchanged.
- validated: actual `TUI.doRender` differential output handles normal text and ANSI/Unicode overflow within eight columns while preserving image bytes.
- validated: `omp models --json` already uses the registry's available-model predicate, including configured API keys and keyless endpoints; intersecting it with credential DB rows silently drops configured providers. Consume its chat rows with original provider/ID and delegate inference to `omp auth-gateway stdio` with a custom Pi API. Native transport preserves thinking signatures/tool-call identifiers.
- validated: native stdio requests must contain `body.model: "provider/id"` (not just `modelId`), and `context.systemPrompt` must be a string array. The stdio selector wrapper resolves `model`; raw `modelId` bypasses its routed registry. Keep a stable per-session ID and never serialize Pi's cached key or AbortSignal.
- validated: live Opus 5.5 request emitted `bridge_probe` with the requested argument, then consumed the canonical tool result and returned `OPUS_BRIDGE_OK` (16 output tokens on the second turn). This exercised actual omp 18.8.4 inference, not catalog visibility.
- Pi custom catalog requires both `baseUrl` and `apiKey`, even with existing OAuth. `stdio://omp` identifies the custom transport; a quoted absolute `omp token <provider> --raw` command is a genuine vault lookup. Register the extension API without model definitions to avoid replacing user models. Catalog must exist before startup model selection; preserve chosen settings instead of forcing an older preferred default.
- stdio returns buffered SSE, not live token chunks. Cancellation terminates the shared worker and settles pending requests; the next request starts a fresh worker. Returned native event metadata stays untouched; adapt gateway encoder error envelopes that lack an AssistantMessage so Pi's result promise settles.
- Supersedes the earlier direct-credential/default-repair advice in this file: no new copied secrets or refresh tokens; exact managed snapshots protect user edits during resync and `off`.
- failure: Feynman's outer CLI rejects `--extension`; use its preserved `settings.extensions` array to register one absolute managed path outside auto-discovery. Durable bridge metadata and `FEYNMAN_BIN_PATH` resolution also support direct Feynman launch after synchronization.
- failure: removing owned provider fields while user-edited models remain invalidates Pi's entire custom catalog. Retain required `baseUrl`/`apiKey` fields, preserve their ownership on resync, and remove them only when no user models depend on them. Independent review verified both fixes.
- failure: the first real named-session picker run rejected the entire custom catalog because omp exports unknown limits as null (60 context windows, 62 output limits in the observed catalog), while Pi's schema accepts omitted optional limits but not null. Omit null metadata; a standalone native-inference probe cannot prove Pi catalog validity.
- validated: Pi 0.62 resolves `!` credentials through its configured Bash; this workstation fell back to the Windows WSL stub. Explicit Git Bash plus forward-slash executable paths is required when no shellPath exists. Preserve a user's shell choice.
- validated: Feynman overwrites `PI_CODING_AGENT_DIR`; omp honors the same variable and otherwise opens the wrong vault. A real Pi resolver returned a credential only after isolating that variable. Capture any original user override before launch, restore/unset it for both token lookup and the gateway child, and preserve other profile/configuration variables.
- validated: installed final 8sync; actual Pi ModelRegistry accepted all 345 bridged models from 12 providers, with no schema error. Real ConPTY `8sync feynman <name>` opened `/model`, showed Opus 5.5 under anthropic/cloudgo-cc/Cursor, selected anthropic and returned `TUI_OPUS_OK`. Existing native entries remain available; the catalog is no longer only Pi's old bundled rows. Independent final verification: four tests passed, build/node syntax/help passed, binary 4,186,112 bytes passed the size gate.

## ForgeCode zsh-native sessions, one-line installers, update probe (2026-10-11)
- failure: `forge --conversation-id core` → `Invalid conversation id: invalid character: found 'o' at 1`; Forge only accepts RFC 4122 UUIDs. Any fresh v4 UUID works — Forge creates the conversation on first prompt (`Initialize <id>`), later runs print `Continue <id>`. `forge conversation new` prints a UUID but persists nothing, so 8sync generates its own (std `RandomState`).
- validated: Forge's zsh plugin keeps an inherited `_FORGE_CONVERSATION_ID` (`typeset -h` without assignment) and passes it as `--cid` on every `: <prompt>`; `FORGE_BIN` selects the binary. Real ConPTY: `8sync forge probe` → `echo shell-$((6*7))` printed `shell-42`, `: …` answered `ZSHNATIVE81`; relaunch printed `Continue <same id>` and the follow-up recalled `AGAIN-ZSHNATIVE81`; `--tui` continued the same id.
- validated: Windows zsh without admin: MSYS2 `zsh-5.9.2-1-x86_64.pkg.tar.zst` (sha256 9a1342…739fa8) unpacked by `System32\tar.exe` (bsdtar 3.7.2 has libzstd; Git's GNU tar has no zstd) into `%LOCALAPPDATA%\8sync\zsh`, plus Git for Windows' `msys-2.0/iconv/intl/ncursesw6/pcre2-8/gcc_s` DLLs, `usr/share/terminfo`, `etc/fstab` (`/tmp` = usertemp, `/c/` drives) and `etc/nsswitch.conf` (HOME = Windows profile). Git's `usr/bin` on PATH supplies the plugin's coreutils (tail/tr/grep/date/wc/awk). Find Git's root from `git --exec-path` ancestors containing `usr/bin/msys-2.0.dll` (Program Files, scoop and per-user installs differ).
- failure: `forgecode.dev/cli` returned 404 on 2026-10-11 (the user's install minutes earlier worked). Install Forge from `github.com/tailcallhq/forgecode/releases/latest/download/forge-<target>` (all 8 desktop targets exist) into the official installer's locations.
- failure: the stock Windows `curl.exe` 8.8.0 fails EVERY `-w/--write-out` with error 43, while plain `-L` downloads work. Parse the `Location:` header of `curl -sI` instead. `crates/cli/src/verbs/harness/gateway.rs` and `crates/cli/src/verbs/harness/local_model.rs` still use `-w` (same bug, not fixed yet).
- failure: Git for Windows' GNU `sha256sum` prefixes its line with `\` when the path has a backslash, so `first_hex64` saw no hash and every Windows download was "checksum NOT VERIFIED". Strip the marker.
- failure: `curl | sh` installers must not let a child read stdin (it is the script). Give `8sync setup` `/dev/tty` when openable, else `/dev/null`. Stage A on Windows cannot use `sh -c "curl | sh"`; omp and codegraph publish `install.ps1` (`irm | iex`). `winget install` exits non-zero for an installed package → check presence first.
- failure: omp's `install.ps1` without flags installs via `bun install -g` whenever bun exists (ignores `PI_INSTALL_DIR`, throws on bun < 1.3.14) and writes `~/.omp/agent/settings.json` `shellPath` = `C:\Program Files\Git\bin\bash.exe` or else the FIRST `bash.exe` on PATH — the WSL launcher on scoop-Git machines. Stage A runs it as `& ([scriptblock]::Create((irm …/install.ps1))) -Binary` after seeding `shellPath` with Git Bash; the installer keeps an existing value. Testing the flagless form on this box created a bun omp shim that shadowed the native omp; it was removed.
- validated: Windows `8sync.exe` locked by running sessions → `Move-Item 8sync.exe 8sync.old.exe` then copy the new build; running sessions keep working.
- failure: the v0.61.0 release run died ONLY on linux-x86_64 musl (5,390,608 B > 5,304,320 ceiling); `publish release` is skipped, so a red leg means NO release at all. Every asset grew by the same +83…123 KB (four new verbs/bridges). Moving an unpublished tag is safe: `git tag -d vX && git push origin :refs/tags/vX`, fix, re-tag, push.
- failure: `cargo check --no-default-features` is not run anywhere in CI; `forge.rs` called the `#[cfg(feature = "web")]` `here::scaffold_project` and the minimal build stopped compiling unnoticed. `size-report.sh` builds it and is the first thing to catch it.
- failure: on Windows the bash tool is Git Bash without `rustc` on PATH, and `size-report.sh` stat'ed `8sync` without `.exe`. Run it with `TARGET=x86_64-pc-windows-msvc` (the script now falls back to `8sync.exe`).
- failure: `std::fs::write(empty_file, "")` does NOT bump the NTFS mtime, so the update probe's mtime-based 6-hour throttle never started on Windows — every TTY command spawned a GitHub probe. Store the epoch in the file's content.
- failure: the update notice is suppressed whenever `CI` is set — the omp bash tool environment exports `CI=true`; and `help`/`up`/`setup`/`--version` never print it. Verify with bare `8sync` in a ConPTY after `Remove-Item Env:CI`: v0.60.0 printed `! 8sync update available: v0.60.0 → v0.61.0`.
- failure: Windows PowerShell 5.1 launched from pwsh 7 inherits pwsh's `PSModulePath`, loads pwsh's `Microsoft.PowerShell.Utility`, and `Get-FileHash` vanishes — install.ps1 printed "checksum: skipped". Use `[System.Security.Cryptography.SHA256]` directly.
- validated: install.ps1 over a RUNNING `8sync.exe` (PING.EXE copied in as a lock holder): old `Move-Item -Force` → "Cannot create a file when that file already exists"; rename-aside to `.8sync.old.<pid>` → installed 0.61.0, checksum ok.
- failure: `std::fs::canonicalize` on Windows returns `\\?\C:\…`; Git's MSYS `sha256sum` turns it into `\?C:Users…` (No such file), and `sha256_file` mapped that failure to "no hasher on PATH" — every Windows `8sync up` since the checksum guard shipped ran unverified. Unwrap the drive form before handing a path to MSYS tools; try the next hasher when one fails. Proof: `8sync up --force` from a temp copy printed `checksum ok`.
- failure: `platform::core_route` returns `Manual` for every Linux that is not Arch/Fedora, and `install_core_pkg` turns that into a warning + `Ok(())` — the published installer on WSL Ubuntu ended with gh MISSING while the summary listed only `forge` as failed. Debian/Ubuntu get gh from `cli/cli`'s release tarball (`gh_<ver>_linux_<amd64|arm64>.tar.gz`, `<stem>/bin/gh`, verified against `gh_<ver>_checksums.txt`; latest tag from the `releases/latest` Location header) into `~/.local/bin`.
- validated: update chain on Windows with live sessions holding the exe — v0.61.1 probe cached `v0.61.2`, next bare `8sync` printed `! 8sync update available: v0.61.1 → v0.61.2`, `8sync up` installed it (old exe renamed `.8sync.old.<pid>`).
- validated: v0.61.3 published installers on real targets. WSL Ubuntu `curl … | sh` (temp HOME, no TTY) → 8sync, gh v2.102.0 (sha256 ok), omp, codegraph, forge, 58 skills; only zsh failed (sudo needs a password). Windows `irm … install.ps1 | iex` in PS 5.1 under a pwsh-polluted `PSModulePath` → `checksum: ok`, idempotent setup. Installed 0.61.2 `8sync up` → `checksum ok`. A setup run from inside this repo regenerates the sentinel skill lists in AGENTS.md/CLAUDE.md/.cursor with machine-local skills — revert them, never commit.

## Pro zsh, terminal profile, Windows ConPTY latency (2026-10-11)
- failure: a ConPTY probe that never answers the DA1 query (`ESC[c`, sent by MSYS zsh at startup) stalls ~3 s before the first prompt — it looked like an 8sync/zsh slowdown. Real terminals answer at once; the probe must reply `ESC[?61;6;22c` (and `ESC[1;1R` to `ESC[6n`) before startup numbers mean anything. Real `8sync forge` start: ~0.3–0.45 s.
- failure: `%F{8}` inside `${var:+…}` in PROMPT — the `}` of `%F{8}` closes the parameter expansion and leaks `}` into the prompt. Use numeric `%8F`.
- failure: Forge's zsh plugin ends with `compdef` → compinit must run before sourcing it ("command not found: compdef").
- validated: per-Enter latency on Windows MSYS zsh — bare 14 ms, Forge plugin 31 ms, full pro zsh ~200 ms. Bisect inside a live session: zsh-syntax-highlighting `main` ≈ 90 ms, two-line prompt + title ≈ 50 ms. The original forks were fixed: Forge's `$(date +%s)` → `$EPOCHSECONDS` via `functions[...]` patch, and autosuggest async mode (forks per keystroke) unset. Keeping the highlight type cache across prompts did not help.
- validated: zsh-bin v6.1.1 static zsh 5.8 (`zsh-5.8-<os>-<arch>.tar.gz`, layout `bin/ share/ man/`) must run `share/zsh/5.8/scripts/relocate` with no args after unpacking (it derives src=dst from its own path). On WSL Ubuntu (no sudo) it then loads compinit + both plugins + the 8sync prompt.
- validated: unix-only code type-checks from Windows with a fake C toolchain: `CC_<triple>`/`AR_<triple>` pointing at a `.cmd` that just creates the `-o` file, then `cargo check --target x86_64-unknown-linux-gnu` (zstd-sys build scripts otherwise fail).
- validated: the Windows Terminal font is set by a targeted text insert into `"defaults": {` — serde_json without `preserve_order` would reorder the user's settings.json. Re-parse after the insert; leave files with comments alone. The installed Nerd face may be the `NL` variant (`JetBrainsMonoNL Nerd Font`).

## Claude Code kit + `8sync ccc` (2026-10-11)
- validated: Claude Code prompt hooks answer `{"ok", "reason", "impossible"}` — the omp-style-kit's `{"decision":"block"}` Stop prompt is the old schema. Live `claude -p` run (Haiku, API key, isolated `CLAUDE_CONFIG_DIR`): the 8sync Stop gate read `last_assistant_message` "Next I will add unit tests…", returned ok:false, and Claude went on to write + run the test. The UI labels a blocking Stop hook "Stop hook error occurred" — that is the block, not a crash.
- validated: PostToolUse command hook in exec form (`command` = exe path, `args` = [...]) needs no shell, so it runs on Windows without Git Bash/python/jq. `8sync ccc hook verify` fed `cargo check` E0425 back after the first of two edits and stayed silent after the fix.
- failure: a hook `"model": "sonnet"` (alias) logs `[claude-code:unrecognized_model] … query_source:"hook_prompt"` and the hook FAILS OPEN. Hook `model` needs a full id (`claude-sonnet-5` dispatched fine in `--debug-file`).
- failure: Haiku as the AskUserQuestion gate misjudged 2/6 labelled questions with every prompt wording tried (refused a credential request, decided pricing for the user). Sonnet: 6/6. Stop gate on Haiku: 18/18 over 3 runs. Eval script approach: send the exact hook prompt with `$ARGUMENTS` substituted to `/v1/messages`, assert `ok` per labelled case.
- failure: AskUserQuestion is not available in `claude -p` (ToolSearch `select:AskUserQuestion` finds nothing), so the ask gate can only be driven live in an interactive session.
- failure: a PreToolUse test prompt "always reply ok:false" is treated by Sonnet 5 as prompt injection and answered ok:true — test blocking with the default model or a real policy prompt.
- failure: Windows PowerShell 5.1 started from pwsh 7 inherits pwsh's `PSModulePath` and loses `Get-FileHash` → `irm https://claude.ai/install.ps1 | iex` dies. `pkg::run_loud("powershell", …)` now `env_remove("PSModulePath")`; reproduced before, installed 2.1.296 after.
- failure: `harness claude-code` serialized `ClaudeEnv` field names (`anthropic_base_url`) into `~/.claude/settings.json` and replaced the whole file — Claude Code reads only `ANTHROPIC_BASE_URL`. Fixed to merge upper-case keys.
- validated: Claude Code task tools (TaskCreate/TodoWrite) are OFF by default on Opus ≥4.8 / Sonnet ≥4.7 (v2.1.268+); `env.CLAUDE_CODE_ENABLE_TODO_TOOLS=1` turns them on for every model — `/ship` relies on them.

## ccc vs omp tokens/quality, Usage Policy pass (2026-10-11, v0.64.0)
- validated: A/B method — same model (Sonnet 5) via Console API key in both harnesses (`omp -p --api-key` overrides omp's stored OAuth: an invalid key gives 401), fresh repo copy per run, hidden tests run afterwards. Compare input tokens = `in + cache_read + cache_write`, not dollars: a new `CLAUDE_CONFIG_DIR` starts with a cold prompt cache (cache writes 39-48k vs 18-30k) and inflates cost. The throwaway bench script was deleted after the run.
- validated: 2 tasks × 2 runs, every harness (Claude Code bare, kit 0.63, kit 0.64, omp) passed every hidden test (31 + 20) — no measured quality edge for ccc. Claude Code processed 1.3-2× omp's input tokens because it makes ~2× the requests: about 1 in 7 Claude requests carried several tool calls, omp batched (14 calls in 9 requests). Dollars stayed close (cache reads 0.1×).
- failure: a kit `CLAUDE.md` line telling Claude to batch independent tool calls changed nothing (14% multi-call requests with and without). Removed.
- validated: in an 8sync repo the per-request prefix is the lever. su-code: omp 56.2k, ccc 0.63 41.0k, ccc 0.64 34.3k. `CLAUDE.md` used to carry the full 8k force-load block (mostly bare skill names); now a 0.7k pointer block (`claude_block` in `crates/cli/src/verbs/skill/inject.rs`). `@AGENTS.md` import measured 20.5k — rejected. Claude Code skips AGENTS.md whenever any CLAUDE.md exists (≥2.1.277 reads AGENTS.md only when there is none). Pointer still works: "size ceiling + script?" answered right in 4 turns.
- validated: Claude Code permission path rules are consulted only as `Read(...)`/`Edit(...)`; a `Write(path)` rule is accepted and ignored (docs: permissions). omp-style-kit v2's `Write(./.env)` denies did nothing.
- validated: kit v2 `aup-guard.sh` let `C:\x\.env` (backslash) and `.env.staging` through, cost ~240 ms/call (5 python spawns, 6.3 s cold), and blocked fixture keys; its `aup_audit.py` reported 1 BLOCK + 52 WARN on su-code, all false positives, in 37 s. Native `8sync ccc hook guard`: ~23 ms/call on Windows.
- failure: guard v1 denied `git add -A -- . ':!.env.production'` (Claude's own safe exclusion). Pathspec exclusions (`:!`, `:^`, `:(exclude)`) now count; live run: guard denied the plain sweep, Claude added `.gitignore` and committed cleanly. Sonnet 5 refuses to hardcode keys or write `.env` on its own — the guard is defence in depth, keep its strings split (`concat!`) so the source never trips itself.
- validated: Usage Policy (anthropic.com/legal/aup, effective 2026-11-12) + 8 Sync rules: a Claude subscription (OAuth `sk-ant-oat…`) stays in Claude Code / claude.ai. Repo fixes: `feynman auth-omp` bridges no `anthropic` provider and no `claude-*` model; `harness claude-code` with a non-Anthropic endpoint configures Claude Code only; `doctor` warns on omp's OAuth login. This machine: omp's `anthropic` credentials are OAuth (4 rows) — user action, not changed by 8sync. The Forge key (`sk-ant-usr…`) is accepted by `api.anthropic.com/v1/models` (Console key).
- failure (incident, 2026-10-11): a WSL install check run inline as `wsl -d Ubuntu-22.04 -- bash -lc 'export HOME=$(mktemp -d …); …; rm -rf "$HOME"'` from the agent's Windows shell emptied the real `/home/admin8syncdev`. Through that path variables set inside the quoted script are not seen by later expansions (repro in docker-desktop: `sh -c 'export H=$(echo x); echo "[$H]"'` printed `[]`), so `$HOME` was the real home at cleanup. Rules: never `rm -rf "$VAR"` in a one-liner through `wsl.exe`/nested shells; put WSL checks in a script file (`wsl -- bash /mnt/c/…/x.sh`) and guard deletes with a literal prefix (`case $D in /tmp/8sync-home.*) rm -rf "$D";; esac`). Recovery failed: the C: VSS shadow copy (2026-10-09 23:08) holds the distro's `ext4.vhdx` at full size but all zeros (no `vhdxfile` signature even read in place, so it was never captured — a VSS snapshot is no backup for WSL disks; use `wsl --export`), and `ext4magic` (journal + magic scan) on a copy of the after-delete disk found nothing under the home. Copy kept at `C:\Users\Admin\wsl-recovery\` for a file-carving attempt (photorec) if wanted.

## ccc speed, skills, org rules, legal sync (2026-10-11, v0.65.0)
- validated: where ccc lost time to omp on a hard task (calc evaluator, Sonnet 5, Console key): API time was 94% of wall-clock; Sonnet 5 runs Claude Code at `high` effort by default and wrote 17.6-20.6k output tokens vs 9.4k at `medium`. `medium`: 100 s and 161 s (9.4k / 15.3k out), 11/11 both; mean 131 s vs omp 138 s (124-155 s) — on par, large run-to-run spread. Kit sets `effortLevel: "medium"` only when unset (Opus 5.5 ignores the key, already medium).
- validated: synchronous PostToolUse `cargo check` cost 2.5 s/edit warm (8.6 s cold) on su-code; `asyncRewake: true` + exit 2/stderr hands failures back without blocking. A Stop hook that blocks on a broken build MUST block once per state, else a deliberate stop loops to Claude Code's 8-continuation cap (seen live: 9 blocks on Haiku).
- validated: auto-mode classifier ≈ 0.65 s per non-read-only Bash command (5× `cargo check`: auto 14.9 s, allow rule 12.0 s, bypass 11.4 s). Narrow `Bash(prefix*)` allow rules skip it; compound commands are matched per part.
- failure: Anthropic's `<use_parallel_tool_calls>` snippet via `--append-system-prompt-file` did not raise multi-call requests in Claude Code on a lookup task (0 vs 0); not shipped.
- validated: Claude Code skill listing — 237 project skills with descriptions cost +18.4k tokens per request (57.3k vs 38.9k); `skillOverrides` `"name-only"` for on-demand skills brings it to 41.1k. Personal (`~/.claude/skills`) beats project on the same name, so linking bundled skills to `~/.omp/skills/<name>` keeps Claude Code on the fresh copy when a repo vendored an old one (live: Skill(8sync-cli) → `8sync hz max`).
- validated: `@path` imports in `~/.claude/CLAUDE.md` resolve relative to that file and load without the external-import dialog (user scope); the org rules imported this way answered 3 rules questions with 0 tool calls.
- failure: managed `.gitignore` used `.cursor/skills/` / `.zcode/skills/`; git sees a symlink/junction as a file, so `dir/` never matched and su-code tracked both links. Use no trailing slash for link paths; test runs real `git status`.
- validated: `ccc` launch auto-update — a 0.63.9 copy with cache `v0.64.0` downloaded v0.64.0 (checksum ok), renamed itself aside and re-ran `ccc . <name> -p` on the new binary (9.9 s total). The selfup cache can be stale (`latest_tag` said v0.63.0 after v0.64.0 shipped) because the probe only runs from a TTY every 6 h.
- validated: Anthropic legal pages fetch fine from scripts (anthropic.com HTML `<main>`, code.claude.com `.md`, sitemap for `/legal/` index); Windows `curl -w` still fails with error 43 — probe with Python urllib. The CI draft step (Claude Code, acceptEdits, Read/Edit/git show) changed only the effective-date reference on a simulated diff ($0.20).
- failure: `install.ps1` resolved the latest tag with `Invoke-WebRequest -MaximumRedirection 0`; on Windows PowerShell 5.1 that throws InvalidOperationException with no `.Response`, so only the unauthenticated API fallback ever worked — and it is rate-limited (60/h/IP; GitHub runners hit it). Fix: `[Net.HttpWebRequest]` HEAD with `AllowAutoRedirect = $false` returns the 302 on PS 5.1 and 7. Found by `install-smoke` on `windows-latest`; unix one-liners were fine.
- validated: free CI on the public repo — `install-smoke` (workflow_run after Release + weekly) runs the real one-liners on ubuntu-latest, ubuntu-24.04-arm, macos-latest, macos-15-intel (last x86_64 macOS label, until 2027-08), windows-latest. A `release` event made with GITHUB_TOKEN does not trigger workflows; `workflow_run` on `Release` does.
- validated: MSYS `rm -rf` does not follow a Windows junction (target survives; it only fails to remove the link) — safe for `~/.claude/skills/<name>` → `~/.omp/skills/<name>`. Remove a junction with `cmd /c rmdir <link>`.
- failure (residual): `8sync up` takes the sha256 from the unauthenticated releases API; when that IP is rate-limited it installs with "checksum NOT VERIFIED" (v0.65.0 here; digest checked by hand: match).
- failure: ccc kit drift (2026-10-12) — repo CLAUDE.md files kept the old 8.6 KB full block (never re-injected), the parent `~/startup/CLAUDE.md` duplicated it byte-for-byte, and the block forced 4 SKILL.md reads before the first tool → first request 57.9k–58.2k tokens vs omp 37.1k (transcript `message.usage`, deduped by requestId; jq chokes on `-`-prefixed project dirs → use python). Fix: compact block, ancestor dedupe, skip `su-code/` memory dirs.
- failure: `mirror_mcp` left Claude Code with `mcpServers: []` silently (serena not on PATH) while CLAUDE.md said the MCP tools were "always" there → wasted tool-search turns. Never claim a tool exists without checking registration.
- validated: compliance pattern for third-party harnesses — exact host allowlist (official/Bedrock/Vertex/Foundry/localhost/self-hosted env) + `sk-ant-api` prefix gate before any token leaves Claude Code; ForgeCode's `claude_code` provider and Feynman's "Claude Max" login are the fake-client pattern to avoid (research: `plans/2026-10-12-ccc-beyond-omp.md`).
- failure: Feynman 0.5.35 renamed Pi to `@earendil-works/*`; bridge must probe both scopes. Default bridged model gemini-2.5-flash fails deepresearch with MALFORMED_FUNCTION_CALL.
- validated: prompt Stop gate blocks while background subagents run (4× in one session) → gate prompt must allow "waiting on background tasks it launched".
- validated: kit as a public Claude Code plugin — marketplace `.claude-plugin/marketplace.json` → source `./assets/claude` (agents + skills/ship); `claude plugin validate .` + `claude --plugin-dir ./assets/claude plugin details 8sync-kit` (~630 tok always-on). Release bump must update `assets/claude/.claude-plugin/plugin.json` version (test `plugin_manifest_version_matches_crate` fails otherwise).
- failure: systemd rejects a quoted `WorkingDirectory="…"` ("path is not absolute") — unit would never start; caught only by `systemd-analyze --user verify` in UAT, not by unit tests. Always verify generated units with systemd-analyze.
- validated: Claude Code `TaskCreated`/`TaskCompleted` hooks fire under `claude -p` (task tools on) with project `.claude/settings.json` hooks using `command` + `args` + `async:true` → `8sync hq hook` → Discord forum post + tag PATCH (mock API, 2026-10-12).
- failure: release size gate is not in PR CI — PR #5 alone pushed the estimated linux asset ~35 KB over the ceiling unnoticed. Local release builds run ~137,888 B below the published asset; compare commits with separate --target-dir builds.
- failure: prompt Stop gate kept the turn going 3× after the user explicitly said STOP/wait → gate must yield to an explicit user stop.
- failure: Claude Code task ids restart at "1" in every session — keying HQ state by bare task_id made the 2nd session's tasks look like yesterday's done tasks and silently skipped them. Caught only by running two real `claude -p` sessions back to back. Key = team_name (shared list across lead/teammates) else session_id.
- validated: parallel async hooks for the same task (3×TaskCreated + TaskCompleted) → exactly 1 forum post via a lock-held `pending` reservation in state.

## ccc vs omp vs Forge, destructive-command guard, native Stop gate (2026-10-12, after v0.66.0)
- validated: same-model bench (Sonnet 5.5; ccc on the claude.ai team login, omp + Forge on a Console key; 4 tasks Rust/TS/Python/explore × 2 runs; cost at API list price for all) — every arm 82/82 hidden checks. Wall median ccc 43 s, omp 36-40 s, Forge 36-38 s; $/run omp 0.10-0.11 < ccc 0.14-0.15 ≈ Forge 0.155-0.16. ccc spends ~9.5 s per run outside API time (Claude Code startup + hooks); omp writes ~1/3 fewer output tokens. Rig: `C:/Users/Admin/tmp/hb/bench.py` (deleted after the release; recipe in the `bench-ccc-vs-omp` managed skill).
- validated: live safety probes (direct instructions, no tricks). omp 18.9 and Forge 2.14 **deleted a folder outside the repo, printed `.env` and force-pushed**: omp approval defaults to yolo, Forge `restricted=false`, neither has a destructive-command or secret guard (omp `bashInterceptor`/TTSR only steer tool choice). ccc 0.66 blocked all three: force-push and the delete by the guard (`ask` → denial under `claude -p`), `.env` by the org rules before any tool call.
- failure: the Haiku `type: prompt` Stop gate re-sent the transcript at every turn end (~48k Haiku tokens and ~2.6 s per bench run) and most of its 20 real blocks were turns waiting for a background agent, which Claude Code wakes by itself. Replaced by a native gate (`ccc/gate.rs`) that never blocks while `background_tasks` has a running entry.
- validated: `disableClaudeAiConnectors: true` (env `ENABLE_CLAUDEAI_MCP_SERVERS=false`) cut a trivial `claude -p` from ~8.4 s to ~7.2 s and the Sonnet prefix by ~2k tokens on a claude.ai login; it also removes Gmail/Drive tools from prompt-injection reach.
- failure: `claude -p` waits for background-task notifications before exiting: a here-doc `cat > f <<'EOF'` that hit the 120 s Bash timeout was moved to the background and the run sat ~570 s more (one 750 s outlier in 8 ccc runs).
- validated: on Windows with Git Bash, Claude Code has a separate `PowerShell` tool (same `tool_input.command`); `Bash(...)` permission rules and a `Bash` hook matcher do not cover it, and any Bash deny rule silently disables the PowerShell tool. The guard matcher is `Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit`.
- failure: the first guard parser (round-1 review) let commands hide behind syntax it did not model — an apostrophe in a `#` comment or here-doc body opened a "quote" to the end of input (`# what's left⏎rm -rf "$HOME"` passed), `then`/`do`/`!`, `eval`/`iex`, `$(…)` inside double quotes, `ssh host 'rm -rf ~'`, `sudo -u git rm -rf /` (wrapper option values). Fix: a lexer that models comments, here-docs, here-strings, escapes, continuations and substitutions, plus a structure-blind raw-text backstop for the catastrophic targets so a parser gap alone cannot let `rm -rf ~` through. With the backstop off, the parser alone still classifies every regression row except the over-depth one (parser → ask, backstop → deny).
- validated: release builds use `panic = "abort"`, so `catch_unwind` cannot save a hook; `8sync ccc hook guard` installs a panic hook that prints an `ask` decision and exits 0. Not `onFailure: "block"`: a missing 8sync binary would then block every tool call.
- failure: a security-reviewer prompt phrased as an attacker "bypass hunt" was refused by the cyber usage-policy filter; the same review phrased as defensive coverage of accidental destructive commands ran.
- validated: omp treats a `models.yml` provider without `auth:` as OAuth (Claude Code identity block + 1 h cache writes) even on a Console key (custom-models.ts:59-62).
- validated: a linux-musl release build works on Windows with `~/tmp/zigcc/zcc.cmd` (python -m ziglang 0.13) as CC/AR/linker **plus** `CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_RUSTFLAGS="-C link-self-contained=no"` (without it: `ld.lld: duplicate symbol: _start`). Local musl runs ~567 KB below the CI asset (5,180,360 vs 5,747,632 for v0.66.0) — compare deltas between commits, not absolutes.
- failure: guard variable resolution (`out=build; rm -rf "$out"`) first shipped with bypasses a reviewer found by probing the real binary: expanding inside `bash -c '…'` scripts (the lexer had dropped the quotes), `+=`, loop-carried values, `IFS`, functions, `source`, `eval`, namerefs. Rule: resolve only straight-line Bash; any construct that can change a value out of order turns resolution off for the whole command; never rewrite a word that is itself a script.
- validated: Claude Code transcript JSONL marks typed user messages `origin.kind: "human"`; task notifications are `origin.kind: "task-notification"`, skill bodies `isMeta: true`, tool results `tool_result` parts. Stop does not fire on an interrupt, and no hook field carries "user said stop" — read the last human entry from the transcript tail.
- validated: none of CowAgent, oh-my-pi (default `mechanical`), ForgeCode has a no-model "announced work then stopped" detector; OMP's judge examples ("Let me run the tests next.", "I'll fix that now.") make good test seeds (`outputs/stop-gate-guard-design.md`).
- failure: a custom Claude Code channel loaded with `--dangerously-load-development-channels server:<n>` connects (MCP `/mcp` shows it, heartbeats flow) but on a claude.ai Team org with Channels off every notification is dropped silently — only `--debug-file` says "Channel notifications skipped: channels not enabled by org policy", and the pane banner "Channels are not enabled for your org". A heartbeat is not proof of delivery; detect the banner and fall back.
- failure: typing an owner message into a session's tmux pane while Claude Code shows a dialog drives the dialog — "Teach auto mode" advanced to "Also scan shell history: true" (cancelled with Esc before Continue). Any terminal injection must detect dialogs ("Enter to confirm", "Esc to cancel", "←/→ to change", numbered menus) and refuse (409).
- validated: cross-session `SendMessage`/`ListAgents` works between tmux-started interactive sessions on one machine (alpha asked beta, beta answered, alpha relayed); Stop hook `last_assistant_message` gives the turn's answer for a local chat view; hooks inherit the claude process env (EIGHTSYNC_HQ_SESSION).
- failure: `pkill -f <pattern>` in a Bash tool call kills the tool's own shell when the pattern appears in the command line (exit 144). Kill by port/pid (`ss -ltnp`) instead.
- failure: byte-slicing at `rfind(..)+1` panics on non-ASCII (Vietnamese "Lưu ý:"), and release builds use `panic = "abort"` — one Vietnamese colon aborted `8sync ls/show` and the HQ hook. Find boundaries with `char_indices()` + `len_utf8()`, and fuzz any text helper with mixed unicode. Read hook stdin with `read_to_end` + `from_utf8_lossy` (a 1 MiB cap can split a char).
- validated: `8sync ccc . <name> --team` (env CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 for one launch) — lead spawned a teammate from a kit agent and relayed its answer (Claude Code 2.1.296). The bare `ccc . --team` dispatch arm (resume last_used) was checked by hand with a fake `claude` on PATH, not by an automated test.
- failure: Next.js `output: "standalone"` does NOT copy `.next/static` or `public` — running `.next/standalone/server.js` from a build serves `/` 200 but every CSS/JS 404. Package by copying them in, use `next start` for dev checkouts, and smoke the tarball at runtime (CI now curls `/` and one `/_next/static` asset). pnpm's symlinked `.pnpm` store breaks Windows bsdtar and `cp -L` alone breaks resolution — hoist into a flat node_modules.
