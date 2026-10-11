# v0.63.0 — `8sync ccc` (Claude Code named sessions) + the 8sync kit

## Goal
`8sync ccc . <name>` = Claude Code by name per repo; `8sync setup` installs Claude Code + a kit that makes it autonomous (verify hook, stop gate, ask gate, subagents, /ship) without asking more than needed.

## Checklist
- [x] Audit of omp-style-kit.zip: old Stop prompt schema (`decision` vs `ok`), python3/bash hook breaks on Windows, tool allow-lists drop MCP, task tools off on new models, project-only paths, ZUS-specific CLAUDE.md.
- [x] `ccc.rs` + shared `uuid_sessions.rs`; kit assets in `assets/claude/`; Stage A `claude-code` + `claude-kit` steps; PSModulePath fix; `harness claude-code` merge fix.
- [x] Live proof (API key, isolated CLAUDE_CONFIG_DIR): verify hook fed E0425 back; stop gate continued "Next I will add tests"; named session remembered PELICAN-63 across runs; `. rm` deleted the transcript. Gates: stop 18/18 Haiku, ask 6/6 Sonnet (Haiku 4/6).
- [x] 136 tests; `--no-default-features` builds; size ceiling 5,505,024 B with attribution.
- [ ] Release v0.63.0 + published installer run (WSL: Claude Code + kit) + `8sync up` here + README setup capture.

## Current
Committing v0.63.0.

## Next
After release: `8sync up` on this box, then `8sync ccc kit` (hooks point at the installed exe). Ask gate never driven live (AskUserQuestion is absent in `claude -p`).

# v0.61.0 → v0.62.0 — zsh-native `8sync forge`, self-setting-up installers, pro zsh + terminal profile

## Goal
Every member installs with one line (`curl … /install | sh` · `irm … /install.ps1 | iex`) and gets the full AI harness (gh, omp, codegraph, forge + zsh, skills, `harness global`); `8sync forge <name>` is a zsh shell bound to the named Forge conversation (`--tui` = Forge TUI); `8sync` notices new releases.

## Checklist
- [x] `8sync forge <name>`: zsh + Forge plugin, `_FORGE_CONVERSATION_ID` = session UUID; `--tui`; `-p` one-shot; Forge auto-install; Windows zsh (MSYS2, sha256-pinned) + ConPTY proof.
- [x] Stage A: omp `-Binary`, codegraph `install.ps1`, gh, forge + zsh, `harness global`; installers auto-run `setup --no-profile` (`SUSYNC_NO_SETUP=1` opts out).
- [x] v0.61.0 published (run 38091385123, 5 assets) after size-gate attribution (ceiling 5180 → 5300 KiB) and the `--no-default-features` build fix.
- [x] Notice proven: installed v0.60.0 printed `! 8sync update available: v0.60.0 → v0.61.0`.
- [x] v0.61.1 published (run 38092267328): NTFS-proof probe throttle (epoch in content), install.ps1 replaces a running exe, install.ps1 checksum via .NET — each reproduced before, proven after. `8sync up` 0.60.0 → 0.61.1 on this box with live sessions holding the exe.
- [x] v0.61.2 published (run 38092880520): `8sync up` checksum on Windows (`\\?\` path broke MSYS `sha256sum`). Installed 0.61.1 printed the v0.61.2 notice and `8sync up` installed it.
- [x] Published `install.sh` on WSL Ubuntu (temp HOME): 8sync, omp, codegraph, forge, 58 skills, APPEND_SYSTEM — but gh MISSING (Manual route) and zsh needs sudo.
- [x] `8sync forge probe` zsh re-proven after setup patched `~/.zshrc`: `shell-42`, session UUID, `: …` → `ZSHCHECK612`.
- [x] v0.61.3 published (run 38093303867): WSL `install.sh` installed gh v2.102.0 (sha256 ok) next to 8sync/omp/codegraph/forge; `8sync up` 0.61.2 → 0.61.3 printed `checksum ok`; published `install.ps1` one-liner (PS 5.1, temp BinDir) → checksum ok + idempotent setup.
- [x] v0.62.0 local: pro zsh (two-line prompt, async Forge segment, menu completion, pinned autosuggestions + syntax-highlighting), `--profile terminal` on every OS, zsh-bin without sudo, `$HOME` PATH block, README rewrite. ConPTY: 0.36 s to prompt, ~0.2 s per command, `:` prompt → `SHELL062`. 134 tests; linux/macOS type-check via fake cc.
- [x] v0.62.0 published (run 38097639848, 5 assets, linux-x86_64 5,415,216 B under the 5,427,200 ceiling). WSL Ubuntu published installer: gh, omp, codegraph, forge, zsh-bin 5.8 (no sudo), plugins — zero failed steps; `--profile terminal` → helix 25.07.1 (sha256 ok) + pro zsh block. Windows: `8sync up` 0.61.3 → 0.62.0 `checksum ok`; `--profile terminal` set the Windows Terminal default font.

## Current
Done. Installed binary on this box: 0.62.0.

## Next
Known residuals: `crates/cli/src/verbs/harness/gateway.rs` and `crates/cli/src/verbs/harness/local_model.rs` still use `curl -w` (fails on stock Windows curl 8.8.0); no CI job builds `--no-default-features`; zsh on Debian/Ubuntu needs sudo (prompts in a real terminal, fails unattended); macOS without Homebrew still gets "install gh manually".

# HANDOFF 2026-10-08 — urgent omp Windows input hotfix

## Goal
Stop win32-input-mode packet fragments appearing in the omp composer under delayed input.

## Checklist
- [x] Reproduced incomplete Windows Backspace packet escaping after 75 ms.
- [x] Patched packet framing; preserved complete Escape key timeout behavior.
- [x] 23 input tests pass, including all Backspace byte splits delayed 500 ms.
- [x] Built and installed local omp 18.8.3 hotfix; installed binary smoke test passes.
- [x] Saved reproducible source/test patch in `scripts/omp-win32-record-framing.patch`.

## Current
Local runtime hotfix installed; existing running omp processes still use their old executable.
No prolonged live-session observation yet. No auth/model settings changed; no commit/push.
Backup: `C:\Users\Admin\AppData\Local\omp\omp.exe.pre-win32-framing-20261008-094351.bak`.

## Next
Restart affected omp sessions with `omp --continue` to load the patched executable.
Upstream updates may replace this local build; reapply the saved patch when necessary.
Previous feature state follows unchanged.

# STATE (8sync managed — live plan; rewrite ở MỖI phase-boundary, đọc đầu phiên)
> **Active feature:** Claude Code settings & Anthropic auto-setup (`8sync harness claude-code`).

## Goal
Tự động hóa hoàn toàn việc nạp cấu hình Claude Code JSON vào `8sync` và `omp`, cấu hình User environment variables, đăng ký 9 model Claude mới nhất vào `models.yml`, đặt model default (`claude-fable-5-1`), verify live probe và đóng gói thành command + script tiện dụng.

## Checklist
- [x] Task 1: Thiết kế module `crates/cli/src/verbs/harness/claude_code.rs` và tích hợp vào `8sync harness claude-code` (aliases: `claude`, `claude-key`, `import-claude`).
- [x] Task 2: Viết standalone scripts `scripts/setup-claude-key.ps1` và `scripts/setup-claude-key.sh` hỗ trợ pipeline stdin / JSON argument.
- [x] Task 3: Đăng ký đầy đủ 9 model Claude hiện tại vào `models.yml` (override `anthropic` và `apikey-fun`) với đầy đủ context window 1M, token limit 128K và thinking mode.
- [x] Task 4: Cập nhật default modelRole sang `anthropic/claude-fable-5-1:high` và advisor sang `anthropic/claude-opus-5:high`.
- [x] Task 5: Live probe test thành công qua endpoint `https://api.apikey.fun/v1/messages` (816ms).
- [x] Task 6: Unit tests 98/98 PASS, size-gate 4.11 MB (dưới goal 4.19 MB và trần 5.18 MB).
- [x] Task 7: Cập nhật `CHANGELOG.md` và `su-code/KNOWLEDGE.md`.

## Current
Đã hoàn thành toàn bộ mã nguồn, unit tests, release build và verification live. Sẵn sàng commit, push và release theo yêu cầu của user.

## Next
Commit toàn bộ thay đổi, push lên GitHub remote và tạo tag / release nếu cần.
