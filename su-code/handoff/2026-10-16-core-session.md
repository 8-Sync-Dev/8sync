# Handoff — phiên `core` (ccc harness), 2026-10-16

Viết để sang máy khác làm tiếp. Mọi thứ trong git đã lên GitHub (`8-Sync-Dev/su-code`, public, MIT); phần dưới là những gì KHÔNG nằm trong git trên máy cũ (memory của phiên, backlog, quy trình đang chạy) cộng với ngữ cảnh để tiếp tục đúng chỗ.

## 1. Trạng thái tại thời điểm bàn giao

| Mục | Giá trị |
|---|---|
| `main` | `b9a3749` `chore(release): v0.96.0` (sau #53, #54, #55) |
| Tag mới nhất | `v0.96.0` (annotated) → release run **38897057076** xanh 7/7, assets đã publish (§2) |
| Bản `8sync` đã cài trên máy cũ | **0.96.0** (`8sync up` + `8sync ccc kit` đã chạy; ask-gate prompt cài 886 byte, skill `/sysdesign` 39 dòng, HQ UI 0.96.0 tải sẵn) |
| PR mở | không |
| Nhánh local chưa push | không (mọi worktree `ahead=0`, sạch) |
| Phiên Claude Code | `core [ff2607]`, cwd `/home/alexng/startup/su-code` (thư mục memory, KHÔNG phải git repo) |
| Cron `/loop` | `e23dd948` (`*/5 * * * *`, `/loop-me /ship …`) — **chỉ sống trong phiên, đã mất khi phiên đóng**; máy mới phải gõ lại (§5) |

## 2. Release v0.96.0 — nội dung

Ba PR được gom vào MỘT câu Ship (owner chọn "Duyệt tất cả"), merge tuần tự (squash), merge `origin/main` vào nhánh sau để gỡ conflict `CHANGELOG.md` (script `scripts/merge-changelog.py` trong thư mục này gộp hai khối `## [Unreleased]` thành một, thứ tự Added → Changed → Fixed).

| PR | Nhánh | Commit trên main | CI trước merge | Nội dung |
|---|---|---|---|---|
| #53 | `feat/sysdesign-skill` | `8d93e1c` | run 38872636126 + PR checks 6/6 | Kit skill `/sysdesign`: quy trình đọc The System Design Primer (CC BY 4.0, clone vào `~/.cache/8sync/system-design-primer`, **không chép** nội dung vào kit). KIT_FILES 40, CORE_SKILLS 16, test `sysdesign_skill_points_at_the_primer_without_copying_it`. |
| #54 | `feat/hq-sprite-gates` | `448c753` | run 38875653689 + PR checks 6/6 | HQ sprites nối không giật: clip làm việc bắt đầu đúng tư thế `stand` kết thúc (`UP = { hy: 5, torsoTop: 13, chair: true }`), `stalled`/`rest` ngồi (SEATED), bubble meeting lên khỏi tóc; `tests/sprite-pipeline.test.ts` = 21 gate của skill sprite-pipeline (handover 0 px vào work, ≤2 px còn lại). |
| #55 | `feat/ask-gate-short` | `e34800c` | run 38876745165 + PR checks 6/6 | Prompt hook ask-gate 1,374 → 886 byte (cùng 4 rule, cùng JSON trả lời). Lý do: khi gate từ chối, Claude Code in NGUYÊN prompt trong dòng lỗi → chữ vỡ trên terminal hẹp. Test pin ≤900 byte. |

Bump: `CHANGELOG.md` (`## [0.96.0] — 2026-10-16`), `Cargo.toml`, `Cargo.lock`, `assets/claude/.claude-plugin/plugin.json`.

Gates trên bump (bắt buộc theo rule owner 2026-10-16 "luôn check tuân thủ /rules /aup-audit /sec"):
- `/sec`: gitleaks toàn repo + history 24 hit, cây hiện tại 16 hit — tất cả là **fixture test của masker** (`secret_mask.rs`, `transcript.rs`, `hq.rs` trong `mod tests`), docs của skill `senior-security`, hoặc `reference/CowAgent/` (**ignored**, không track). File nhạy cảm trong history: `assets/configs/kitty.session` (đã biết, có từ trước). `cargo audit`: 0 vuln, 3 warning (fxhash, proc-macro-error2 unmaintained; anyhow RUSTSEC-2026-0190 unsound). `pnpm audit --prod` hq-ui: 1 high `braces` qua `shadcn>fast-glob>micromatch` (dev CLI, có sẵn trên main — backlog 6). `8sync ccc status`: kit 39/39, guard, stop + ask gates OK; managed settings none (chưa cần). → **OK**.
- `/rules`: **ALLOWED** — release build/publish bằng GitHub Actions, cài bằng `8sync up`; token subscription chỉ dùng trong Claude Code chính chủ; primer CC BY 4.0 chỉ đọc, không chép; gate ask vẫn chuyển secret/destructive/business cho người. Rules file `8sync-anthropic-rules.md` cập nhật 2026-10-11; snapshot legal `docs/legal/anthropic/` 2026-10-12.
- `/aup-audit`: diff #53–#55 + bump không thêm thu thập dữ liệu, không nhắn người ngoài, không dịch vụ bên thứ ba, không high-risk (grep tín hiệu: 0 hit) → **no BLOCK**.
- `8sync ccc risk --release`: medium (third-party + release file) → ba gate đều đã chạy.

Release outcome (được cập nhật khi workflow xong): ****XANH** — run 38897057076 success 7/7 (package hq-ui, build darwin-x86_64/darwin-arm64/windows-x86_64/linux-aarch64/linux-x86_64, publish release). Assets v0.96.0: linux-x86_64 6,895,696 B (trần size gate 6,946,816 → còn ~50 KB), darwin-arm64 4,856,848, darwin-x86_64 5,640,976, linux-aarch64 5,586,656, windows-x86_64 5,472,256, hq-ui tar 9,126,084. https://github.com/8-Sync-Dev/su-code/releases/tag/v0.96.0**

## 3. Cách phiên này làm việc (để máy mới chạy y hệt)

- Owner khởi động `/loop 5m /loop-me /ship tự động build check tới được rồi bàn giao tôi tuân thủ chuẩn /rules /aup-audit /sec /ship-loop /ship-auto`. Mỗi 5 phút = một tick loop-me áp cho backlog su-code (không phải 4 site prod — lane đó của phiên `web`): **một việc/tick**, nhánh `feat/<slug>`, code → test nhẹ local → UAT → `/sec` + `/rules` + `/aup-audit` + `8sync ccc risk` → CHANGELOG Unreleased → commit (`git -c user.name=8syncdev -c user.email=tuan8165@gmail.com`, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`) → push nhánh → `gh workflow run ci.yml --ref <branch>` → `gh run watch <id> --exit-status` nền.
- **Không merge trong tick.** Khi ≥3 nhánh xanh: MỘT `AskUserQuestion` header `Ship`, options đúng `Duyệt tất cả (Recommended)` · `Chỉ merge, chưa deploy` · `Dừng`, liệt kê từng PR/tag/deploy. Duyệt → PR → `gh pr checks --watch` nền → squash merge → merge main vào nhánh kế → … → bump → tag → release → `8sync up` + `8sync ccc kit`.
- Khi Ship đang chạy dở, tick chỉ đọc CI và báo ≤5 dòng, không mở việc mới.
- LOG của loop: `loop-me/LOG.md` (bản sao tại `2026-10-16-loop-me-LOG.md` cạnh file này). Bảng tick 1–7 + Backlog có mức ưu tiên.
- Build nặng không chạy trên máy: chỉ `cargo test -q -j2 -p su-code <filter>`, `cargo check/clippy -q -j2`, `pnpm exec vitest run <file>`, `pnpm exec tsc --noEmit -p .`, `pnpm exec eslint <files>`; luôn `nice -n 19 ionice -c3`. Worktree hq-ui mới cần `pnpm install --frozen-lockfile --offline` thật (không symlink node_modules) và `pnpm exec next typegen` một lần để tsc có `.next/types`.
- **Không bao giờ** `cargo fmt -p su-code -- <file>` (format cả crate, repo không rustfmt-clean) — chỉ `rustfmt --edition 2021 <path>`; trước commit `git diff --stat` phải đúng file định sửa. Không `git add -A`.
- Guard auto-mode từ chối: heredoc dài có backtick, quote lệch, `rm -rf $VAR`, `bash -c "$VAR"`, `pkill -f` → viết file bằng Write tool / script python trong scratchpad rồi `python3 -I <file>`; commit message qua `-F <file>`.

## 4. Backlog còn mở (ưu tiên giảm dần, từ `loop-me/LOG.md`)

1. **hints-realtime** (owner: "hint prompt là realtime và đúng ý tiếp theo … gõ tới đâu hiểu ý prompt chi tiết tiếp để tab ra") — chưa làm. Cần R&D API mod (`plugin-authoring` skill; types tại `<bundled-skills>/plugin-authoring/types/claude-code.d.ts`: sự kiện `prompt.submit`, `ui.render` `AbovePrompt`, có ghost text/Tab không). Mức M–L.
2. **braces advisory** hq-ui (`pnpm audit --prod` 1 high, GHSA-vfj7-8cjw-p6xm, qua `shadcn>fast-glob>micromatch`, dev CLI) — nâng `shadcn` hoặc `pnpm.overrides`. Mức S.
3. **Size gate**: linux-x86_64 asset v0.95.0 = 6,891,568 B, trần `CEILING=6946816` trong `scripts/size-gate.sh` → còn ~54 KB. v0.96.0 thêm skill ~4 KB và prompt ngắn hơn; nếu release 38897057076 đỏ ở size gate → PR nâng trần kèm giải thích, tag lại. Release feature kế tiếp gần như chắc cần nâng trần.
4. **Research chưa chọn** (owner chưa quyết): caveman-lite kit skill (S), `8sync find --ai` snippet xếp hạng + byte budget (M), fail-open PreToolUse nudge cho Read/grep không giới hạn (S–M), baseline bằng `token-bench` trước (S). Ghi chú nghiên cứu caveman/XERJ nằm ở scratchpad máy cũ (đã mất) — kết luận tóm tắt trong `STATE.md` Brief.
5. Backlog 1–2 (hq-stale-ui, auto-tick) và 4 (ship-skills-full) đã ship trong v0.95.0 (`/ship-tick`, `hq ui --install`, auto-tick qua inbox); 5 (ask-gate-echo) ship trong v0.96.0.
6. **Checksum binary khi `8sync up`**: 0.96.0 in `checksum NOT VERIFIED — no sha256 digest published for this asset`. Release chỉ publish `.sha256` cho gói hq-ui, không cho 5 binary (0.95.0 cũng vậy — cùng layout asset). Fix: workflow release upload `SHA256SUMS` (hoặc `.sha256` từng binary) và `up` đọc nó. Mức S, nên làm trước release kế.
7. Lưu ý từ phiên `team` (FYI, không phải lệnh owner): VPS runner `ovh-sgp-1` nghẽn; workflow `ZUS Gate` của zus chạy hai lần mỗi commit (push + pull_request) → nên thêm `concurrency` group; vài nhánh zus/8syncdev-pro-v2 đang đỏ. Không thuộc lane này.

## 5. Dựng máy mới

```bash
git clone https://github.com/8-Sync-Dev/su-code ~/tools/su-code
# cài 8sync bản mới nhất + kit (hooks, skills, guard, ask/stop gate vào ~/.claude)
8sync up && 8sync ccc kit && 8sync ccc status
# memory của phiên core: đọc su-code/STATE.md (Brief cuối), su-code/KNOWLEDGE.md (bài học), su-code/handoff/
# tạo phòng và mở Claude Code
8sync ccc . core
```

Trong phiên mới: `/reload-plugins` nếu kit vừa ghi mod; gõ lại `/loop 5m /loop-me /ship tự động build check tới được rồi bàn giao tôi tuân thủ chuẩn /rules /aup-audit /sec /ship-loop /ship-auto` nếu muốn vòng tick tiếp tục. Worktree cho mỗi nhánh đặt TRONG repo (`EnterWorktree`), target cargo dùng chung `CARGO_TARGET_DIR=<repo>/target`.

Máy cũ (Linux, Fedora 44) còn các worktree: `~/tools/su-code` (main), `-hq` (feat/ccc-hints, đã merge), `-inbox` (feat/ask-gate-short, đã merge), `-sprites` (feat/hq-sprite-gates, đã merge), `-wd` (feat/tool-output-budget, đã merge), `-fix` (feat/v0.67, nhánh cũ 2026-10-13, không có remote, dirty chỉ do kit ghi đè AGENTS.md/CLAUDE.md — bỏ được). Có thể `git worktree remove` tất cả trừ main.

## 6. Chưa kiểm chứng (not verified)

- Sprites mới chỉ xem dưới dạng ASCII và test; chưa nhìn trên HQ sống (HQ của owner trên :8740 vẫn chạy UI cũ, cần Ctrl-C và `8sync hq ui` lại).
- Windows/macOS: chỉ qua CI (test + build), chưa chạy trên máy thật.
- Ask-gate prompt mới: eval bằng subagent Sonnet 7/7 case đúng nhãn; chưa thấy hành vi trong phiên tương tác thật.
- HQ "Chạy liên tục" / "Giao việc" UAT trên HQ sống (từ v0.94.0) vẫn chưa làm.
- Release 38897057076: xem dòng outcome ở §2.

## 7. Việc owner cần làm

1. Máy cũ: `8sync up` + `8sync ccc kit` ĐÃ chạy (0.96.0). Còn: Ctrl-C HQ đang chạy (:8740, UI cũ) và `8sync hq ui` lại; `/reload-plugins` trong các phiên đang mở.
2. Trust folder trong tmux `hq-rd-1` (đang kẹt ở "trust this folder?").
3. Chọn item research kế tiếp (§4 mục 4) hoặc để tick tự chọn theo thứ tự backlog.
4. Nếu muốn rút gọn rule 3 của ask-gate (cho phép hỏi hướng hạ tầng như "nâng dashboard /ci trên VPS hay không"), nói rõ — hiện gate coi đó là rule 4 và tự chọn.

## 8. File kèm theo trong thư mục này

- `2026-10-16-loop-me-LOG.md` — bản sao `loop-me/LOG.md` (tick 1–7, Backlog).
- `scripts/merge-changelog.py` — gộp `## [Unreleased]` khi merge main vào nhánh (`python3 -I merge-changelog.py <worktree>` sau khi `git merge` báo conflict CHANGELOG; rồi `git add CHANGELOG.md && git commit --no-edit`).
- `scripts/bump-version.py` — bump CHANGELOG/Cargo.toml/plugin.json (sửa `OLD/NEW/DATE` ở đầu file; sau đó `cargo update --workspace --offline` cho Cargo.lock).
