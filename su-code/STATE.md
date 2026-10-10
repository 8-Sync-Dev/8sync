# v0.61.0 — zsh-native `8sync forge`, self-setting-up installers, rate-limit-proof update notice

## Goal
Every member installs with one line (`curl … /install | sh` · `irm … /install.ps1 | iex`) and gets the full AI harness (gh, omp, codegraph, forge + zsh, skills, `harness global`); `8sync forge <name>` is a zsh shell bound to the named Forge conversation (`--tui` = Forge TUI); `8sync up` notices reach users even when the GitHub API is throttled.

## Checklist
- [x] `8sync forge <name>`: zsh + Forge plugin, `_FORGE_CONVERSATION_ID` = session UUID; `--tui`; `-p` one-shot; Forge auto-install from GitHub release.
- [x] Windows zsh: MSYS2 zsh 5.9.2 (sha256-pinned) in `%LOCALAPPDATA%\8sync\zsh` + Git for Windows runtime/terminfo/fstab.
- [x] ConPTY proof: shell command, `: prompt` → `ZSHNATIVE81`, relaunch `Continue <same id>` + recall, `--tui` continues same id.
- [x] Stage A: omp `-Binary` + Git Bash `shellPath` seed, codegraph `install.ps1`, gh presence check, forge + zsh, `harness global`; `--no-profile` unattended.
- [x] Installers auto-run `setup --no-profile` (`SUSYNC_NO_SETUP=1` opts out); setup stdin never the script pipe.
- [x] Update probe/`up` fall back to the `releases/latest` Location header (Windows curl 8.8.0 breaks every `-w`); GNU `sha256sum` `\`-escaped output parsed.
- [ ] Commit, push, tag v0.61.0; verify release assets + Pages installers; run the published one-liners; verify the update notice.

## Current
Local 0.61.0 build: 130 tests pass, size gate OK. Real `setup --no-profile` on this Windows box: all steps succeeded. Fresh-install invocations of omp (`-Binary`) and codegraph (`install.ps1`) proven into temp dirs with user PATH restored.

## Next
Release, then run the published installers (Windows here; WSL Ubuntu with a temp HOME) and a v0.60.0 → v0.61.0 notice check. Known residual: `crates/cli/src/verbs/harness/gateway.rs` and `crates/cli/src/verbs/harness/local_model.rs` still use `curl -w` (fails on stock Windows curl 8.8.0).

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
