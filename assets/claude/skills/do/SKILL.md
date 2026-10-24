---
name: do
description: Quick small change, level 1 — /do <việc>, "sửa nhanh", "đổi nhỏ", typo, rename, one-function fix. One pass, no plan, no commit, light checks (lint + touched test module), then report. Refuses work spanning >3 files or touching auth/secrets/deploy (use /ship).
argument-hint: <việc nhỏ>
---
Việc: $ARGUMENTS

Level 1 của thang `/do` → `/ship` → `/ship-auto` → `/ship-loop` → `/autopilot` (xem `/ship`). Một lượt, không plan, không commit.

1. **Cổng từ chối** — đọc đủ để biết việc chạm file nào (trail/LSP trước grep). Từ chối, KHÔNG sửa gì, nói rõ lý do và bảo owner dùng `/ship <việc>` nếu:
   - chạm > 3 file, hoặc cần thiết kế/migration/đổi API công khai;
   - đụng cấu hình Claude Code / kit: `.claude/settings*.json`, hooks, guard/deny rule, `CLAUDE.md`, `AGENTS.md`, `su-code/skills/**`;
   - đụng auth/OAuth, secret/`.env`/credential, deploy/CI/release config, dependency, hoặc thu thập dữ liệu / nhắn người ngoài;
   - mô tả mơ hồ tới mức phải hỏi nhiều câu (hỏi tối đa MỘT `AskUserQuestion`, Recommended đầu).
2. **Làm** — đọc file trước khi sửa; sửa tối thiểu; không refactor lan; đếm lại giới hạn ≤3 file trước lần sửa cuối. Kiểm tra `su-code/STATE.md`/`8sync ccc . ls`: file đang thuộc session khác → dừng, `SendMessage` hỏi.
3. **Check nhẹ** — chỉ lint + module test mà thay đổi chạm tới, luôn `nice -n 19 ionice -c3` và `-j2` (vd `nice -n 19 ionice -c3 cargo test -j2 -p <crate> <module>`). Build/test nặng (`cargo build --release`, `next build`, docker…) KHÔNG chạy local — nói owner dùng `/ship` (chạy trên CI). Không sửa test cho pass; fail → sửa gốc, tối đa 3 lần rồi báo thật.
4. **Báo cáo** (≤8 dòng): file đã sửa, lệnh đã chạy + output ngắn, cái chưa verify. Không `git add`/commit/push; để nguyên diff cho owner.

Mọi câu "xong/pass" phải kèm lệnh + output đã chạy; không có → ghi "not verified". Không dùng `bypassPermissions`. Không in/ghi secret.
