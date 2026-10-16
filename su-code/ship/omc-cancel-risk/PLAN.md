# omc-cancel-risk — PLAN (2026-10-16)

Owner chọn (AskUserQuestion): "Commit doc + port #1 và #4" từ nghiên cứu oh-my-claudecode
(github.com/Yeachan-Heo/oh-my-claudecode, MIT, commit 44c27308912c, package v5.7.4). Chỉ port ý tưởng,
viết lại Rust; không copy code OMC.

## Phạm vi
1. `research/omc-features.md` — bản scan 64 tính năng (đã đọc đủ 123 dòng trước khi commit vào repo public).
2. **`8sync ccc cancel [--all] [--session <tên>] [--json]`** (OMC `skills/cancel/SKILL.md`: một lệnh huỷ hết, fail-closed,
   mặc định chỉ session mình, `--all` mới xuyên session).
   - Phạm vi session: goal, urgent của session; mọi loop còn sống trong `su-code/ship/ACTIVE`
     (`stopped = "cancelled"`); xoá ACTIVE.
   - `--all`: thêm mọi loop còn sống trong `su-code/ship/*/loop.json`, `idle off`, `delegate off`.
   - Fail-closed: không có session id và không `--session` → từ chối, không làm gì, exit 1. Bước nào lỗi
     (ghi file hỏng…) → in `FAILED <việc>` và exit 1; in từng việc đã huỷ / bỏ qua.
   - Không huỷ được từ ngoài: scheduled task của Claude Code (`/loop`, CronCreate) → in nhắc `/loop clear`
     (không chạm protocol của Claude Code).
3. **`8sync ccc risk [--base <ref>] [--json] [--paths a,b]`** (OMC `scripts/risk-assess.mjs` + `review-gate.mjs`:
   phân loại đường dẫn diff → gate bắt buộc). Phân loại: auth/oauth/login · data-collection · external-messaging ·
   third-party (MCP/plugin/dependency manifest) · secret/credential file · release (version, CHANGELOG, workflows) ·
   high-risk (tín dụng, tuyển dụng, y tế, pháp lý) · hooks/guard của kit. Gate: `sec` luôn; `rules` + `aup-audit`
   khi auth/data/messaging/third-party/high-risk; high-risk thêm "người review + disclose AI"; release → `rules`
   + `aup-audit` trước release. Diff = `git diff --name-only <base>` + untracked; base mặc định `origin/main`
   (không có → `HEAD`). Exit 0 luôn (thông tin), JSON cho skill/hook.
4. Bảng verb: `help::VERBS` + `RESERVED` + `TEXT`, `hint::CCC_VERBS`; skill ship/ship-loop/ship-auto/autopilot
   nhắc chạy `8sync ccc risk` trước `/sec`. CHANGELOG Unreleased ghi nguồn ý tưởng (MIT).

## Acceptance criteria (mỗi cái một lệnh, exit 0 = pass)
| # | Criterion | Lệnh |
|---|---|---|
| C1 | cancel: phạm vi session, --all, fail-closed | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code cancel_` |
| C2 | risk: phân loại + gate + json | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code risk_` |
| C3 | help VERBS khớp dispatcher, hint typeahead | `nice -n 19 ionice -c3 cargo test -q -j2 -p su-code 'ccc::help' && nice -n 19 ionice -c3 cargo test -q -j2 -p su-code hint_` |
| C4 | research doc trong repo | `test -s research/omc-features.md && [ "$(grep -c '^| ' research/omc-features.md)" -ge 60 ] && grep -q MIT research/omc-features.md` |
| C5 | UAT thật: `8sync ccc risk --json` trên diff này liệt kê gate; `cancel` không session → exit 1 | `scripts/uat/omc-cancel-risk.sh` |
| C6 | clippy file đụng | `nice -n 19 ionice -c3 cargo clippy -q -j2 -p su-code 2>&1 \| grep -E 'ccc/(cancel|risk|help|hint)\.rs' ; test $? -eq 1` |
| C7 | CI 3 OS | `gh run watch <id> --exit-status` |

Giả định: `cancel` không chạm scheduled task của Claude Code (chỉ nhắc); `risk` chỉ đọc tên file, không nội dung.
