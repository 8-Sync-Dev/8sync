<!-- 8sync:harness:begin -->
## 🧠 8sync harness

- **Always-on (đọc theo thứ tự; CORE đọc body ngay, SPECIALIST đọc khi task khớp):** codegraph → karpathy-guidelines → ponytail → assp-skill → impeccable → taste-skill → 8sync-cli → image-routing → locate-anything.
- **Cách tận dụng:** codegraph = explore code (query/callers/callees, không grep) · karpathy + ponytail = YAGNI, làm ít nhất, xoá > thêm · impeccable = design CHUẨN, BẮT BUỘC khi UI/design (đọc body lúc đó) + taste chống slop.
- **Output lớn (>~50 dòng) → BẮT BUỘC `headroom_compress`** trước khi vào context.
- **Sau mỗi thay đổi:** cập nhật `CHANGELOG.md` (Unreleased) + ghi học được vào file này (prefix `validated:` nếu test/build xác nhận, `hypothesis:` nếu chưa).
<!-- 8sync:harness:end -->

# KNOWLEDGE (8sync managed — append-only)

## Learnings (append-only — ghi DƯỚI đây; KHÔNG sửa block `8sync:harness` ở trên)
_(consolidated 19 dòng cũ → su-code/archive/KNOWLEDGE-1787286513.md)_
  normal invocation and it is a full recursive walk), and `find -path`/`-regex` were all open.
  Tools with no single-file mode worth preserving (`rg`, `fd`, `git grep`) are blocked outright;
  only `grep` needs flag analysis.
- failure (`Bun.YAML.parse` does NOT reject duplicate mapping keys — it takes the LAST): the code
  assumed a duplicate top-level key would make omp fail loudly, so appending an 8sync block next
  to a user-authored `bashInterceptor:` was thought to be self-announcing. In reality omp
  (17.2.10, `var {YAML:jQf}=globalThis.Bun`) silently keeps the last key, and 8sync always appends
  last — so every rule the user wrote was voided on each `8sync harness`, with no error anywhere.
  Rule: when a managed writer cannot merge, it must DETECT the user's block and BAIL OUT with a
  warning, never append-and-hope. Never assume a parser is strict; verify what it actually does.
- validated (`8sync up` was Linux-only — hard-coded `-linux-x86_64` asset + extension-less
  `~/.local/bin/8sync` dest + plain rename): on Windows this downloaded the Linux binary, wrote a
  file with no `.exe`, and tried to `rename` over a running `.exe` (forbidden). The extension-less
  file then made Windows pop the "Select an app to open '8sync'" picker. Fix in `selfup.rs`: derive
  the asset label from `platform::os()`+`std::env::consts::ARCH` (mind macOS arm = `arm64`, not
  `aarch64`), install to `std::env::current_exe()` (replace 8sync wherever it lives, all OSes), and
  do a Windows-safe replace (rename the live `.exe` aside to `.8sync.old.<pid>`, then move the new
  one in). Rule: any self-updater must key the asset name, install path, AND replace strategy off
  the target OS — a `#[cfg(unix)]`-only path silently ships a broken updater to every other OS.

- validated: **Encore Go apps compile với `go` thuần trong podman — không cần Docker/encore codegen** (2026-08-07, feature ai-router-hub M0). `go mod tidy && go vet ./... && go build ./... && go test ./...` trong `docker.io/library/golang:1.24` (mount source + named volume `/go` cache) PASS trên app có `//encore:api`/`//encore:authhandler` — các directive chỉ là comment với `go` thuần, hàm là Go thường. `encore.dev` resolve qua go mod (v1.57.13). ⇒ verify **Go-level** (compile/type/logic) được ở máy rootless-podman-no-Docker; chỉ `encore run/build/test` mới cần Docker (dựng runtime + codegen). Cách rẻ để verify Encore mà không dựng Docker.
- failure: **`errs.Code(err)` panic dưới `go test` thuần** (encore.dev/beta/errs builder.go:121 `doPanic` — helper cần Encore runtime). Fix: soi field trực tiếp `err.(*errs.Error).Code == errs.Unauthenticated` (construct + đọc field KHÔNG cần runtime). Rule: test Encore package bằng `go test` thuần chỉ chạm hàm/logic thuần; mọi helper `errs.*`/`rlog.*`/`auth.UserID()` cần runtime → dùng `encore test` (Docker) hoặc né bằng field access.
- failure: **grep-based endpoint-lister tự match comment của chính nó** (verify-public-endpoints.sh: regex `//encore:api public...path=` quét cả `*.md`/`*.sh` bắt phải path ví dụ `/x` trong comment). Fix: `grep --include='*.go'` — endpoint chỉ định nghĩa trong Go source. Rule: script "liệt kê directive từ source" phải giới hạn theo đuôi file, không quét doc/self.
- validated: **Encore API type risk — `interface{}`/`any` trong request/response có thể bị Encore schema-parser từ chối** (go build pass nhưng `encore run` fail). Chưa xác nhận (defer Docker box). Nếu envelope dùng `Result interface{}` → sẵn sàng đổi `json.RawMessage`/type cụ thể. Kiểm TRƯỚC khi tin `encore run`.
- validated (multi-session, 2026-08-08): **omp exposes exactly the session levers 8sync needs — build a thin layer, don't reinvent.** `omp --session-dir <dir>` scopes storage+lookup; `--continue` then resumes the latest conversation *in that dir* → one dir per named session = isolated conversations with ZERO uuid tracking (verified: captured omp argv shows `--session-dir …/<name> … --continue`). Fresh session = launch WITHOUT `--continue`; resume = WITH. Always route through `models::ModelConfig::resume_flags()` so the STEP-0 `--tools` allowlist + `--advisor` survive (a bare `Command::new("omp")` would silently drop them).
- validated (worktree-per-session merge, ECC blueprint, MIT): the whole isolation+merge engine is `git` CLI shell-out, no crate. `git worktree add -b 8sync/<name> <path> HEAD` per session; land via read-only `git merge-tree --write-tree <target> <branch>` (exit code = conflict truth; parse conflicted files by taking non-blank lines after the tree-oid and dropping any containing a space to skip "Auto-merging …"/"CONFLICT …" info lines) → `git merge --no-edit` → on conflict `git rebase <target>` in the worktree (auto `rebase --abort` on fail) → `git worktree remove` + `git branch -d`. Sequential merges make the target advance so branch-vs-branch conflicts surface naturally. `git branch -d` (not -D) keeps unmerged work safe by default.
- gotcha (multi-session): `8sync . new` runs `seed_project_context` on the MAIN repo, writing untracked `AGENTS.md`/`su-code/`/`CLAUDE.md` when missing → a fresh test repo then looks "dirty" and `merge` (which refuses a dirty main tree) balks until you commit them. Real repos already track these → fresh-repo artifact, not a bug. Smoke tests must `git add -A && commit` after the first `new`.
- validated (testing an omp-launching verb headlessly): stub `omp` with `printf '#!/bin/sh\nexit 0\n'` on `PATH` + isolated `XDG_CONFIG_HOME` → exercises the real registry + git engine without a TTY hang; assert on recorded argv for launch-flag correctness. `git init -qb main` for a deterministic base-branch name.
- failure (fedora-harness, 2026-08-08): **`8sync setup` aborted at step 3 of 8 on every non-Arch Linux.** `setup.rs` gated the AUR-helper step on `platform::Os::Linux` instead of the Arch family; on Fedora `pacman_install_safe` failed, and `try_step` PROPAGATES in strict (non-`yolo`) mode, so the `?` killed the run before `codegraph`/`configs`/`skills`/`codegraph-skill`. Symptom looked like "skills never install on Fedora"; cause was one wrong gate five steps earlier. Rule: an OS check is not a distro check — gate package work by distro family, and remember `try_step` only swallows errors when `yolo` (`--full`/`--profile`/`--community`).
- failure (fedora-harness): **8sync wrote machine-absolute skill paths into every project's `AGENTS.md`.** `skill/inject.rs` built `p.join(entry)` from a cwd-derived PathBuf, emitting `/home/alexdev/...` / `/home/alexng/...` into the sentinel block. On any other clone those files do not exist, so omp was told to read nothing and silently skipped the skills — the real reason "omp hay bỏ qua skills". The on-demand tier 15 lines below already built relative strings, so the correct pattern was sitting next to the bug. `harness audit` structurally could not catch it: it `continue`d on every `/`-prefixed token. Rule: anything written into a COMMITTED file must be repo-relative (or `~/`-anchored for genuinely-global paths), and the audit that guards it must flag `/home/`,`/Users/`,`/root/` while still ignoring `/etc`,`/usr`,`/tmp`.
- validated (fedora-harness): **prose does not steer omp; enforced levers do.** `APPEND_SYSTEM.md` asking for codegraph/serena/cbm is advisory and gets ignored under load. The mechanisms omp implements in CODE are: a TTSR rule (`condition:` + `scope: "tool:grep(*)"` + `interruptMode: tool-only`) that aborts the stream mid-tool-call and re-injects — zero prompt tokens and compaction-proof because rules re-evaluate every stream; a `tool_call` hook returning `{block:true, reason}` (fail-closed); and `bashInterceptor.patterns[]` to close the `bash rg` escape. Distilled reference lives in `su-code/omp-reference/LEVERS.md` (26 levers). Gotcha: an interceptor whose `tool:` names an MCP server is SILENTLY SKIPPED when that tool is absent — point `tool:` at something always present (`lsp`) and name the real replacement in `message`.
- validated (fedora-harness): **capability-gate any enforcement you deploy.** Blocking `grep` on a box with no codegraph/serena/cbm dead-ends the session. Gate at deploy time (install the rule/interceptor only when a replacement is actually reachable, delete both when it is not) because omp cannot express a capability predicate inside `condition:`/`pattern`. TTSR `repeatMode: once` also caps the blast radius at one restarted turn.
- gotcha (fedora-harness): **`dnf` is not `pacman` and needs LESS code.** RPM transactions are atomic, so the hand-rolled pacman snapshot+`-Rns` rollback must NOT be ported; use `dnf history undo <id>`. But a PLAN of two dnf transactions (install missing, then upgrade outdated) is not atomic as a whole — if the upgrade fails after the install committed, you must undo the committed one. Also: on dnf5 the `copr` subcommand comes from **`dnf5-plugins`**, not the dnf4-era `dnf-plugins-core`, and Fedora 44's `/etc/os-release` has **no `ID_LIKE`** line, so distro detection cannot rely on it.
- validated (fedora-harness): **6 agents editing one Rust crate in parallel compiled on the FIRST try** because the exact trait/struct signatures were fixed in the batch `context` up front and every agent was told to skip `cargo build`. Contract-first + no mid-flight validation is what makes wide fan-out safe; agents then self-corrected over IRC (one caught that `load_all()` returns `HashMap`, not a slice, and refused my wrong signature).
- gotcha (fedora-harness): **`.gitignore` bare `reference/` silently swallows any `reference/` dir at any depth.** Distilled omp docs written to `su-code/reference/omp/` vanished from `git status`; relocated to `su-code/omp-reference/`. `assets/skills/impeccable/reference/` survives only because it was tracked BEFORE the rule existed. Verify a new doc dir is actually tracked (`git check-ignore -v <file>`) before assuming it is committed.
- gotcha: a "dead code" warning can be a real bug in disguise — `undo` was unused because nothing wired it to the partial-failure path, and deleting the warning properly meant fixing the rollback. Prefer wiring over `#[allow(dead_code)]`.

## v0.54.0 release closeout (2026-08-09)

- **validated: an independent reviewer pass before a tag pays for itself.** Two `task` reviewers
  (`reviewer` + `security-reviewer`) on `git diff origin/main..HEAD` found 28 issues the author
  (me) had missed, including one that would have broken the release outright and two exploitable
  bugs. Cost ~18 min wall-clock, run in parallel with the test suite. Do this for every tag.
- **failure: `--full`/`--yall` hardcoded the maintainer's personal bundle** (`"alexdev"`) as the
  meaning of "install everything". Any teammate running it got Lian Li chassis drivers, a
  Vietnamese IME and DisplayLink DKMS. Root cause: three separate hardcoded profile lists that
  could disagree with the `Visibility` enum. Fix = one `offered_profiles()` source of truth, and
  `Visibility` now defaults to `Personal` so a forgotten marker fails CLOSED.
- **failure: a profile's own `post_install` guard is too late to stop a bad install.**
  `profile::apply` installs packages first, so `nvidia`'s "no NVIDIA GPU detected" check ran after
  the driver stack was already on an AMD box. Gates must live in `resolve`'s walk, per bundle
  member, before any package work.
- **failure: `std::thread::spawn` cannot do background work in a CLI.** The M5 "non-blocking"
  update check spawned a detached thread; the runtime kills it when `main` returns, and
  `touch_check()` had already burned the 6-hour window — so the notice could never print. A CLI
  that needs work to outlive the command must re-exec itself as a detached child process and read
  the result from cache on the next run.
- **failure: `JSON.stringify` is not shell quoting.** It escapes `"` and `\` but a double-quoted
  bash word still performs `$()`/backtick substitution. `git commit -m ${JSON.stringify(msg)}` via
  `bash -lc`, with `msg` model-supplied, was arbitrary code execution. Use argv (`spawnSync(file,
  args)`); never build a shell string from data.
- **failure: package names spliced into a `sudo` argv with no `--`.** A profile entry starting
  with `-` becomes a package-manager FLAG: `--hookdir=` gives alpm attacker-written root hooks.
  Validate AND emit `--`.
- **validated: `if command -v X; then X …; fi` is a fail-OPEN security gate** — it exits 0 when X
  is absent. Probe presence separately and say so when a check did not run.
- **validated: test the negative direction too.** The existing guard only checked
  list→asset, so two new skills silently never deployed. Every registry needs both directions.

## v0.56.0 — `8sync hz`, `8sync lcd`, and the duplicate-command upgrade bug (2026-08-09)

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
